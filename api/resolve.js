const { resolveSchema } = require('./lib/resolver.js');
const ontology = require('./Semantic/ontology.json');
const posDict  = require('./Semantic/pos_dictionary.json');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const { headers, filename, learnedAliases } = req.body;
    if (!headers || !Array.isArray(headers)) {
      return res.status(400).json({ error: 'headers array required' });
    }

    // Session-only learning: aliases the user taught earlier this session arrive
    // here and are applied via the resolver's org-alias path (confidence 0.95),
    // so previously-taught columns auto-resolve in later uploads without re-asking.
    // (Cross-session persistence to a real org profile store is the next-session
    // item — this just threads the in-session memory through.)
    const sessionProfile = (learnedAliases && Object.keys(learnedAliases).length > 0)
      ? { custom_column_aliases: learnedAliases }
      : null;

    const schema = resolveSchema(headers, filename || 'upload.csv', {
      posDict,
      ontology,
      orgProfile: sessionProfile
    });

    res.json(schema);
  } catch (err) {
    console.error('resolve error:', err);
    res.status(500).json({ error: err.message });
  }
};
