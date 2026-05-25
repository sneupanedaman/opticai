const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic();

// ---- Semantic layer ----
const { buildQueryContext, contextToSystemBlock } = require('./lib/retriever.js');
const ontology    = require('./Semantic/ontology.json');
const calcRules   = require('./Semantic/calc_rules.json');
const diagnostics = require('./Semantic/diagnostic_graph.json');
const posDict     = require('./Semantic/pos_dictionary.json');

/**
 * The frontend embeds two markers into the system prompt string:
 *   __RESOLVED_SCHEMAS__:{json}
 *   __USER_QUESTION__:{text}
 *
 * We extract them here, build the semantic context block, then strip
 * the markers so the model never sees them directly.
 */
function extractSemanticPayload(system) {
  const schemaMatch   = system.match(/__RESOLVED_SCHEMAS__:([\s\S]*?)(?=__USER_QUESTION__|$)/);
  const questionMatch = system.match(/__USER_QUESTION__:([\s\S]*?)$/);

  let schemas  = {};
  let question = '';

  try { if (schemaMatch)   schemas  = JSON.parse(schemaMatch[1].trim());  } catch(e) {}
  try { if (questionMatch) question = questionMatch[1].trim();             } catch(e) {}

  const cleanSystem = system
    .replace(/__RESOLVED_SCHEMAS__:[\s\S]*?(?=__USER_QUESTION__|$)/, '')
    .replace(/__USER_QUESTION__:[\s\S]*$/, '')
    .trim();

  return { schemas, question, cleanSystem };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const { model, max_tokens, system, messages } = req.body;

    // Guard: reject retired model to surface regressions immediately
    if (model && model.includes('4-5')) {
      return res.status(400).json({ error: 'Retired model — update app.html to claude-sonnet-4-6' });
    }

    // Pull out the schema payload the frontend embedded
    const { schemas, question, cleanSystem } = extractSemanticPayload(system || '');

    // Build semantic context block if any schemas were resolved
    let semanticBlock = '';
    const schemaList = Object.values(schemas);
    if (schemaList.length > 0) {
      try {
        // Merge all uploaded schemas into one unified schema.
        // On canonId conflicts, higher-confidence mapping wins.
        // Dominant POS = the one with the most high-confidence mappings.
        let mergedResolved = {};
        let posCounts = {};
        for (const schema of schemaList) {
          const pos = schema.posSystem || 'unknown';
          if (!posCounts[pos]) posCounts[pos] = 0;
          for (const [canonId, mapping] of Object.entries(schema.resolved || {})) {
            const existing = mergedResolved[canonId];
            if (!existing || (mapping.confidence || 0) > (existing.confidence || 0)) {
              mergedResolved[canonId] = mapping;
            }
            if ((mapping.confidence || 0) >= 0.8) posCounts[pos]++;
          }
        }
        const dominantPos = Object.entries(posCounts).sort((a,b) => b[1]-a[1])[0]?.[0] || schemaList[0].posSystem;
        const mergedSchema = { ...schemaList[0], posSystem: dominantPos, resolved: mergedResolved };

        const ctx = buildQueryContext({
          schema: mergedSchema,
          question,
          ontology,
          calcRules,
          diagnostics,
          posDict,
          orgProfile: null
        });

        semanticBlock = '\n\n' + contextToSystemBlock(ctx);
      } catch (e) {
        // Non-fatal: if the semantic build fails, chat still works
        console.warn('Semantic context build failed (non-fatal):', e.message);
      }
    }

    const finalSystem = cleanSystem + semanticBlock;

    const response = await client.messages.create({
      model,
      max_tokens,
      system: finalSystem,
      messages
    });

    res.json(response);

  } catch (err) {
    console.error('chat error:', err);
    res.status(500).json({ error: err.message });
  }
};
