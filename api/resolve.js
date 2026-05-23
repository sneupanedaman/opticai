const { resolveSchema } = require('./lib/resolver.js');
const ontology   = require('./Semantic/ontology.json');
const posDict    = require('./Semantic/pos_dictionary.json');

module.exports = async (req, res) => {
  // Allow the frontend to call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const { headers, filename } = req.body;
    if (!headers || !Array.isArray(headers)) {
      return res.status(400).json({ error: 'headers array required' });
    }

    // No org profile yet (manual v1) — pass null, defaults apply
    const schema = resolveSchema(headers, filename || 'upload.csv', {
      posDict,
      ontology,
      orgProfile: null
    });

    res.json(schema);
  } catch (err) {
    console.error('resolve error:', err);
    res.status(500).json({ error: err.message });
  }
};
