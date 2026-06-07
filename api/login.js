import crypto from 'crypto';

/**
 * Auth for OpticAI.
 *
 * Tokens are STATELESS and self-verifying: the token is a base64url payload
 * plus an HMAC-SHA256 signature. /api/chat verifies the signature on its own
 * without any datastore, so login works the moment this is deployed — even
 * before Vercel KV is provisioned. KV is used only for usage metering.
 *
 * Credentials resolve from environment variables if present, otherwise fall
 * back to the built-in demo accounts so the app works on first deploy.
 * To rotate credentials without a redeploy, set these in Vercel → Settings →
 * Environment Variables:  ADMIN_USER, ADMIN_PASS, RICK_USER, RICK_PASS, AUTH_SECRET
 */

const SECRET = process.env.AUTH_SECRET || 'opticai-dev-secret-change-me';
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function accounts() {
  return [
    {
      username: process.env.ADMIN_USER || 'Admin',
      password: process.env.ADMIN_PASS || 'Admin3207',
      role: 'admin',
      displayName: 'Admin',
    },
    {
      username: process.env.RICK_USER || 'Rmiller',
      password: process.env.RICK_PASS || 'Rick7735@',
      role: 'user',
      displayName: 'Rick Miller',
    },
  ];
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const match = accounts().find(
    (a) =>
      a.username.toLowerCase() === String(username).trim().toLowerCase() &&
      a.password === password
  );

  if (!match) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = signToken({
    u: match.username,
    r: match.role,
    n: match.displayName,
    exp: Date.now() + TOKEN_TTL_MS,
  });

  return res.status(200).json({
    token,
    username: match.username,
    role: match.role,
    displayName: match.displayName,
  });
}
