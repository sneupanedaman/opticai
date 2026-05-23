/**
 * OpticAI Semantic Layer — Selective Context Retriever
 * ------------------------------------------------------------
 * THE COST CONTROL MECHANISM.
 *
 * The naive approach injects the entire ontology + calc rules + diagnostic
 * graph into every system prompt. As the knowledge base grows (more POS
 * systems, more metrics, more diagnostics), that balloons token cost on
 * EVERY message — the exact cost driver flagged in the product spec.
 *
 * This retriever injects ONLY:
 *   - definitions for metrics actually present in the resolved schema
 *   - calc rules for those metrics + the org's overrides
 *   - diagnostic chains relevant to the user's question (intent-matched)
 *   - the POS gotchas for the detected POS only
 *
 * Result: system prompt stays roughly flat in size regardless of how big
 * the knowledge base grows. A 50-metric ontology costs the same per query
 * as a 15-metric one if the upload only uses 8 metrics.
 */

// Map free-text question intent to diagnostic symptom keys.
const INTENT_PATTERNS = [
  { symptom: 'high_labor_pct',          re: /\blabor\b.*\b(high|up|over|increas|spike|why)\b|\bwhy\b.*\blabor\b|overtime|overschedul|too many (staff|people|hours)/i },
  { symptom: 'high_food_cost_pct',      re: /\bfood cost\b|\bcogs\b|\bfood %\b|why.*(food|cost)|waste|spoilage|over-?order|portion|variance/i },
  { symptom: 'low_average_check',       re: /\b(average|avg) check\b|\bppa\b|per person|upsell|attach|check.*(low|down|soft|declin)/i },
  { symptom: 'sales_decline',           re: /\bsales\b.*\b(down|drop|declin|fell|falling|soft|slow|lower)\b|why.*sales|traffic|fewer (guests|customers)/i },
  { symptom: 'high_comps_pct',          re: /\bcomps?\b|\bdiscount\b|\bvoid\b|comp.*(high|abuse)/i },
  { symptom: 'guest_satisfaction_drop', re: /\b(satisfaction|review|rating|csat|nps|guest score)\b.*\b(down|drop|fell|low)\b|why.*(satisfaction|rating)/i },
];

function detectIntents(question) {
  const hits = [];
  for (const p of INTENT_PATTERNS) {
    if (p.re.test(question || '')) hits.push(p.symptom);
  }
  return hits;
}

// Which canonical metric ids does a question mention, so we can pull their defs
function detectMentionedMetrics(question, ontology) {
  const q = ' ' + String(question || '').toLowerCase() + ' ';
  const mentioned = new Set();
  for (const [id, def] of Object.entries(ontology.metrics)) {
    const pool = [id, def.label, ...(def.synonyms || [])];
    if (pool.some(t => q.includes(' ' + String(t).toLowerCase()) || q.includes(String(t).toLowerCase().replace(/_/g, ' ')))) {
      mentioned.add(id);
    }
  }
  return mentioned;
}

/**
 * Merge org overrides on top of calc-rule defaults.
 */
function effectiveCalcRules(calcRules, orgProfile) {
  const rules = {};
  for (const [key, rule] of Object.entries(calcRules.definitional_rules)) {
    const overrideKey = rule.override_key;
    const orgVal = orgProfile?.calc_overrides?.[overrideKey];
    const hasOverride = orgVal !== undefined && orgVal !== null;
    let source, value;
    if (hasOverride) {
      source = 'org_override';
      value = orgVal;
    } else if (rule.required_from_user) {
      source = 'UNSET_REQUIRED';   // must be collected from the operator at setup
      value = null;
    } else {
      source = 'industry_default';
      value = rule.default;
    }
    rules[key] = { value, source, why_it_matters: rule.why_it_matters };
  }
  return rules;
}

/**
 * Build the trimmed knowledge context for a single query.
 *
 * @param {object} args
 * @param {object} args.schema        resolved schema from resolver.resolveSchema
 * @param {string} args.question      the user's current question
 * @param {object} args.ontology
 * @param {object} args.calcRules
 * @param {object} args.diagnostics
 * @param {object} args.posDict
 * @param {object} args.orgProfile
 * @returns {object} compact context object to serialize into the system prompt
 */
function buildQueryContext({ schema, question, ontology, calcRules, diagnostics, posDict, orgProfile }) {
  const presentIds = new Set(Object.keys(schema.resolved || {}));

  // Always include metrics that are present, plus any the question mentions,
  // plus the dependencies needed to compute derived metrics.
  const mentioned = detectMentionedMetrics(question, ontology);
  const wanted = new Set([...presentIds, ...mentioned]);

  // pull in dependencies (e.g. labor_pct needs labor_cost + net_sales)
  let added = true;
  while (added) {
    added = false;
    for (const id of [...wanted]) {
      const def = ontology.metrics[id];
      for (const dep of def?.depends_on || []) {
        const depId = dep.split(' ')[0]; // tolerate "net_sales (or gross...)"
        if (ontology.metrics[depId] && !wanted.has(depId)) { wanted.add(depId); added = true; }
      }
    }
  }

  // Trimmed metric definitions
  const metricDefs = {};
  for (const id of wanted) {
    const def = ontology.metrics[id];
    if (!def) continue;
    metricDefs[id] = {
      label: def.label,
      description: def.description,
      formula: def.formula,
      unit: def.unit,
      sane_range: def.sane_range,
      benchmark: def.benchmark,
      notes: def.notes
    };
  }

  // Effective calc rules (defaults + org overrides), only the keys that matter
  const rules = effectiveCalcRules(calcRules, orgProfile);

  // Relevant diagnostics: intent-matched, else none (don't dump all)
  const intents = detectIntents(question);
  const diag = {};
  for (const s of intents) {
    if (diagnostics.symptoms[s]) diag[s] = diagnostics.symptoms[s];
  }

  // Only the detected POS's gotchas
  const pos = posDict.pos_systems[schema.posSystem] || posDict.pos_systems.generic;

  // Org context: segment, targets, custom metrics
  const orgCtx = orgProfile ? {
    org_name: orgProfile.org_name,
    segment: orgProfile.segment,
    targets: orgProfile.targets,
    custom_metrics: orgProfile.custom_metrics,
    location_metadata: orgProfile.location_metadata
  } : { segment: calcRules.concept_to_benchmark_segment.default_if_unknown };

  return {
    pos_system: schema.posSystem,
    pos_gotchas: pos.gotchas,
    resolved_columns: schema.resolved,
    unmapped_columns: schema.unmapped,
    metric_definitions: metricDefs,
    effective_calc_rules: rules,
    relevant_diagnostics: diag,
    org_context: orgCtx,
    matched_intents: intents
  };
}

/**
 * Serialize the query context into a compact instruction block for the
 * system prompt. Kept terse to save tokens.
 */
function contextToSystemBlock(ctx) {
  const lines = [];
  lines.push('# OPTICAI SEMANTIC CONTEXT (authoritative — use these definitions, not your priors)');
  lines.push(`Detected POS: ${ctx.pos_system}. Segment: ${ctx.org_context.segment}.`);
  if (ctx.org_context.org_name) lines.push(`Operator: ${ctx.org_context.org_name}.`);

  lines.push('\n## Column mapping (source CSV -> canonical metric):');
  for (const [id, m] of Object.entries(ctx.resolved_columns)) {
    lines.push(`- "${m.sourceColumn}" => ${id} (conf ${m.confidence})`);
  }
  if (ctx.unmapped_columns?.length) lines.push(`Unmapped (ignore unless asked): ${ctx.unmapped_columns.join(', ')}`);

  lines.push('\n## Metric definitions & valid ranges:');
  for (const [id, d] of Object.entries(ctx.metric_definitions)) {
    let l = `- ${id} (${d.label}): ${d.description}`;
    if (d.formula) l += ` Formula: ${d.formula}.`;
    if (d.sane_range) l += ` Sane range: ${JSON.stringify(d.sane_range)}.`;
    if (d.benchmark && d.benchmark[ctx.org_context.segment]) l += ` ${ctx.org_context.segment} benchmark: ${d.benchmark[ctx.org_context.segment].join('-')}.`;
    if (d.notes) l += ` NOTE: ${d.notes}`;
    lines.push(l);
  }

  lines.push('\n## Calculation rules in effect (org overrides applied):');
  const unset = [];
  for (const [k, r] of Object.entries(ctx.effective_calc_rules)) {
    if (r.source === 'UNSET_REQUIRED') {
      unset.push(k);
      lines.push(`- ${k}: NOT SET — must ask the operator. ${r.why_it_matters}`);
    } else {
      lines.push(`- ${k}: ${JSON.stringify(r.value)} (${r.source})`);
    }
  }
  if (unset.length) {
    lines.push(`! ACTION: ${unset.join(', ')} ${unset.length === 1 ? 'is' : 'are'} required but unset. Ask the operator before relying on any calculation that depends on ${unset.length === 1 ? 'it' : 'them'} (e.g. week-over-week alignment). State the assumption if you must proceed.`);
  }

  if (ctx.org_context.targets) {
    lines.push('\n## This operator\'s targets (measure against these, not just generic benchmarks):');
    lines.push(JSON.stringify(ctx.org_context.targets));
  }

  if (Object.keys(ctx.relevant_diagnostics).length) {
    lines.push('\n## Diagnostic playbook for this question (investigate IN THIS ORDER):');
    for (const [sym, d] of Object.entries(ctx.relevant_diagnostics)) {
      lines.push(`### ${sym}: ${d.headline}`);
      for (const c of d.checks) {
        lines.push(`  ${c.priority}. ${c.id}: look at [${c.look_at.join('; ')}] -> ${c.confirms}${c.why_first ? ' (CHECK FIRST: ' + c.why_first + ')' : ''}`);
      }
    }
  }

  if (ctx.pos_gotchas?.length) {
    lines.push('\n## POS-specific gotchas to respect:');
    ctx.pos_gotchas.forEach(g => lines.push(`- ${g}`));
  }

  return lines.join('\n');
}

module.exports = { buildQueryContext, contextToSystemBlock, detectIntents, effectiveCalcRules };
