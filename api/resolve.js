const crypto = require('crypto');
const { resolveSchema } = require('./lib/resolver.js');
const ontology = require('./Semantic/ontology.json');
const posDict  = require('./Semantic/pos_dictionary.json');

const AUTH_SECRET = process.env.AUTH_SECRET || 'opticai-dev-secret-change-me';
function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const obj = JSON.parse(Buffer.from(body, 'base64url').toString()); if (obj.exp && Date.now() > obj.exp) return null; return obj; }
  catch { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (!verifyToken(req.headers['x-session-token'])) {
    return res.status(401).json({ error: 'Not authenticated. Please sign in again.' });
  }

  try {
    const { headers, filename } = req.body;
    if (!headers || !Array.isArray(headers)) {
      return res.status(400).json({ error: 'headers array required' });
    }

    const schema = resolveSchema(headers, filename || 'upload.csv', {
      posDict,
      ontology,
      orgProfile: null   // no org profile yet (v1 — manual confirmation)
    });

    res.json(schema);
  } catch (err) {
    console.error('resolve error:', err);
    res.status(500).json({ error: err.message });
  }
};
