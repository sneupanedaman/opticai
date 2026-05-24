/**
 * OpticAI Semantic Layer — Column Resolver
 * ------------------------------------------------------------
 * Replaces the old surface-level findCol() substring match with a
 * confidence-scored resolution pass that uses:
 *   1. POS detection (Toast/Square/Clover signatures)
 *   2. Exact POS column-map hits (highest confidence)
 *   3. Org-specific custom aliases (captured over time)
 *   4. Canonical ontology synonyms (normalized exact + token overlap)
 *
 * Output: a resolved schema { canonicalId -> { sourceColumn, confidence, via } }
 * plus a list of ambiguous columns needing user confirmation.
 *
 * This runs server-side (or could run client-side). It is deterministic
 * and cheap — no LLM call needed for resolution itself.
 */

function normalize(name) {
  return String(name).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// Lightweight token Jaccard for fuzzy fallback scoring
function tokenSimilarity(a, b) {
  const ta = new Set(normalize(a).split('_').filter(Boolean));
  const tb = new Set(normalize(b).split('_').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / new Set([...ta, ...tb]).size;
}

const CONFIDENCE = {
  POS_EXACT: 0.98,
  ORG_ALIAS: 0.95,
  ONTOLOGY_EXACT: 0.90,
  ONTOLOGY_CONTAINS: 0.72,
  FUZZY_HIGH: 0.60,
};

// Threshold below which we ask the user instead of auto-mapping
const AUTO_MAP_THRESHOLD = 0.85;
const SUGGEST_THRESHOLD = 0.45;

/**
 * Detect which POS produced this export from its headers + filename.
 */
function detectPos(headers, filename, posDict) {
  const normHeaders = headers.map(normalize);
  const fname = String(filename || '').toLowerCase();
  let best = { system: 'generic', score: 0 };

  for (const [sysId, sys] of Object.entries(posDict.pos_systems)) {
    if (sysId === 'generic') continue;
    const sig = sys.detection_signatures || {};
    let score = 0;
    for (const col of sig.signature_columns || []) {
      if (normHeaders.includes(normalize(col))) score += 1;
    }
    for (const hint of sig.filename_hints || []) {
      if (fname.includes(hint)) score += 0.5;
    }
    if (score > best.score) best = { system: sysId, score };
  }
  // Require at least 2 signature points to claim a specific POS
  return best.score >= 2 ? best.system : 'generic';
}

/**
 * Resolve a single header to a canonical metric id with confidence.
 */
function resolveHeader(header, { posSystem, posDict, ontology, orgProfile }) {
  const norm = normalize(header);
  const candidates = [];

  // 1. POS exact column-map
  const posMap = posDict.pos_systems[posSystem]?.column_map || {};
  for (const [posCol, canonId] of Object.entries(posMap)) {
    if (normalize(posCol) === norm) {
      candidates.push({ canonId, confidence: CONFIDENCE.POS_EXACT, via: `pos:${posSystem}` });
    }
  }

  // 2. Org custom aliases
  const orgAliases = orgProfile?.custom_column_aliases || {};
  for (const [canonId, aliases] of Object.entries(orgAliases)) {
    if (!Array.isArray(aliases)) continue;
    if (aliases.some(a => normalize(a) === norm)) {
      candidates.push({ canonId, confidence: CONFIDENCE.ORG_ALIAS, via: 'org_alias' });
    }
  }

  // 3 + 4. Ontology synonyms (exact, contains, fuzzy)
  const allDefs = { ...ontology.entities, ...ontology.metrics, ...(ontology.identifiers || {}) };
  for (const [canonId, def] of Object.entries(allDefs)) {
    const syns = def.synonyms || [];
    // include POS-specific aliases stored in the ontology too
    const posAliases = def.pos_aliases?.[posSystem] || [];
    const pool = [...syns, ...posAliases, canonId];

    let bestForId = 0, via = null;
    for (const syn of pool) {
      const ns = normalize(syn);
      if (ns === norm) { bestForId = Math.max(bestForId, CONFIDENCE.ONTOLOGY_EXACT); via = 'ontology_exact'; }
      else if (norm.includes(ns) || ns.includes(norm)) {
        if (CONFIDENCE.ONTOLOGY_CONTAINS > bestForId) { bestForId = CONFIDENCE.ONTOLOGY_CONTAINS; via = 'ontology_contains'; }
      } else {
        const sim = tokenSimilarity(syn, header);
        const fuzzy = sim * CONFIDENCE.FUZZY_HIGH;
        if (fuzzy > bestForId && sim >= 0.5) { bestForId = fuzzy; via = 'fuzzy'; }
      }
    }
    if (bestForId > 0) candidates.push({ canonId, confidence: bestForId, via });
  }

  // Collapse to best per canonId, then sort
  const byId = {};
  for (const c of candidates) {
    if (!byId[c.canonId] || c.confidence > byId[c.canonId].confidence) byId[c.canonId] = c;
  }
  let ranked = Object.values(byId).sort((a, b) => b.confidence - a.confidence);
  // Drop weak fuzzy hits that disagree on role with a much stronger candidate
  // (e.g. "revenue" should not surface the dimension "location" as an option).
  if (ranked.length > 1) {
    const roleOf = (id) => (ontology.metrics[id] ? 'measure' : (ontology.entities[id] ? 'dimension' : ((ontology.identifiers || {})[id] ? 'identifier' : 'unknown')));
    const top = ranked[0];
    const topRole = roleOf(top.canonId);
    ranked = ranked.filter(r => {
      if (r === top) return true;
      if (r.confidence >= 0.7) return true;
      // prune cross-role weak candidates
      if (roleOf(r.canonId) !== topRole && (top.confidence - r.confidence) >= 0.15) return false;
      return (top.confidence - r.confidence) < 0.3;
    });
  }
  return ranked;
}

/**
 * Main entry: resolve a full set of headers into a session schema.
 */
function resolveSchema(headers, filename, { posDict, ontology, orgProfile }) {
  const posSystem = detectPos(headers, filename, posDict);

  const resolved = {};      // canonId -> { sourceColumn, confidence, via }
  const identifiers = {};   // canonId -> [{ sourceColumn, confidence, via }]  (join keys/timestamps)
  const ambiguous = [];     // { column, top: [{canonId, confidence}], reason }
  const unmapped = [];      // columns we couldn't place

  const idDefs = ontology.identifiers || {};

  for (const header of headers) {
    const ranked = resolveHeader(header, { posSystem, posDict, ontology, orgProfile });
    const top = ranked[0];

    if (!top || top.confidence < SUGGEST_THRESHOLD) {
      unmapped.push(header);
      continue;
    }

    // Identifiers (order/check/item/employee IDs, raw timestamps) are recognized
    // join keys — capture them so they're never nagged as "unmapped", but keep
    // them out of `resolved` so analytical field mapping stays clean. Multiple
    // columns can map to the same identifier concept (e.g. several timestamps).
    if (idDefs[top.canonId]) {
      if (!identifiers[top.canonId]) identifiers[top.canonId] = [];
      identifiers[top.canonId].push({ sourceColumn: header, confidence: top.confidence, via: top.via });
      continue;
    }

    // Explicit known-ambiguous concepts always require confirmation
    const explicitlyAmbiguous = ['check_count', 'guest_count'].includes(top.canonId)
      && /^(transaction|transactions|count|covers)$/.test(normalize(header));

    const runnerUp = ranked[1];
    // A POS-exact or org-alias hit (>=0.95) is authoritative — don't second-guess
    // it just because an ontology synonym overlaps. Only apply the closeness check
    // to weaker ontology/fuzzy matches.
    const isAuthoritative = top.confidence >= 0.95 && (top.via?.startsWith('pos:') || top.via === 'org_alias');
    const tooClose = !isAuthoritative && runnerUp && (top.confidence - runnerUp.confidence) < 0.12;

    if (top.confidence >= AUTO_MAP_THRESHOLD && !explicitlyAmbiguous && !tooClose) {
      // High confidence — auto-map. Last writer wins only if higher confidence.
      if (!resolved[top.canonId] || resolved[top.canonId].confidence < top.confidence) {
        resolved[top.canonId] = { sourceColumn: header, confidence: top.confidence, via: top.via };
      }
    } else {
      ambiguous.push({
        column: header,
        top: ranked.slice(0, 3).map(r => ({ canonId: r.canonId, confidence: Math.round(r.confidence * 100) / 100, label: (ontology.metrics[r.canonId] || ontology.entities[r.canonId] || (ontology.identifiers || {})[r.canonId] || {}).label || r.canonId })),
        reason: explicitlyAmbiguous ? 'known_ambiguous_concept' : (tooClose ? 'close_candidates' : 'below_auto_threshold')
      });
    }
  }

  return { posSystem, resolved, identifiers, ambiguous, unmapped, headerCount: headers.length };
}

module.exports = { resolveSchema, detectPos, normalize, AUTO_MAP_THRESHOLD };
