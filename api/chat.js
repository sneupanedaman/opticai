const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic();

/**
 * Lazy, fully non-fatal loader for the semantic layer.
 *
 * Previously these were top-level `require`s. If ANY of them failed to
 * resolve at runtime (wrong path, missing file, bad JSON), the entire
 * serverless function failed to initialize and every chat request — in
 * both Operational and Financial modes — returned a 500, which the
 * frontend surfaces as "Sorry, I had trouble with that. Try again."
 *
 * By loading them inside a try/catch and degrading gracefully, the core
 * chat call to Anthropic no longer depends on the semantic layer being
 * present. If the semantic files load, we use them; if not, chat still
 * works (just without the extra schema context).
 */
function loadSemanticLayer() {
  try {
    const { buildQueryContext, contextToSystemBlock } = require('./lib/retriever.js');
    return {
      buildQueryContext,
      contextToSystemBlock,
      ontology:    require('./Semantic/ontology.json'),
      calcRules:   require('./Semantic/calc_rules.json'),
      diagnostics: require('./Semantic/diagnostic_graph.json'),
      posDict:     require('./Semantic/pos_dictionary.json'),
    };
  } catch (e) {
    console.warn('Semantic layer unavailable (non-fatal):', e.message);
    return null;
  }
}

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

    // Build semantic context block if any schemas were resolved AND the
    // semantic layer is available. Any failure here is swallowed so the
    // chat call below always runs.
    let semanticBlock = '';
    const schemaList = Object.values(schemas);
    if (schemaList.length > 0) {
      const sem = loadSemanticLayer();
      if (sem) {
        try {
          const primarySchema = schemaList[0];
          const ctx = sem.buildQueryContext({
            schema: primarySchema,
            question,
            ontology:    sem.ontology,
            calcRules:   sem.calcRules,
            diagnostics: sem.diagnostics,
            posDict:     sem.posDict,
            orgProfile:  null   // no org profile in v1
          });
          semanticBlock = '\n\n' + sem.contextToSystemBlock(ctx);
        } catch (e) {
          console.warn('Semantic context build failed (non-fatal):', e.message);
        }
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
    // Log the real reason server-side; return it so the frontend/devtools
    // can show something more useful than the generic fallback.
    console.error('chat error:', err);
    res.status(500).json({ error: err.message || 'chat handler failed' });
  }
};
