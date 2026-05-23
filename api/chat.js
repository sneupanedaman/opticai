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

    // Pull out the schema payload the frontend embedded
    const { schemas, question, cleanSystem } = extractSemanticPayload(system || '');

    // Build semantic context block if any schemas were resolved
    let semanticBlock = '';
    const schemaList = Object.values(schemas);
    if (schemaList.length > 0) {
      try {
        // Use the first resolved schema as primary context.
        // When multiple files are uploaded we pick the one most relevant
        // to the question — for now, first one is fine for v1.
        const primarySchema = schemaList[0];

        const ctx = buildQueryContext({
          schema: primarySchema,
          question,
          ontology,
          calcRules,
          diagnostics,
          posDict,
          orgProfile: null   // no org profile in v1
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
