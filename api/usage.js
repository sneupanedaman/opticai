import crypto from 'crypto';

/**
 * Admin-only usage report. Verifies the caller's signed token and that their
 * role is 'admin', then returns per-user totals recorded by /api/chat in KV.
 *
 * Degrades gracefully: if Vercel KV isn't provisioned yet, returns an empty
 * report with a flag so the UI can show a "set up KV to see usage" note
 * instead of erroring.
 */

const SECRET = process.env.AUTH_SECRET || 'opticai-dev-secret-change-me';
const API_BUDGET_USD = Number(process.env.API_BUDGET_USD || 0);
const API_ALERT_REMAINING_USD = Number(process.env.API_ALERT_REMAINING_USD || 1);

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  // timing-safe compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (obj.exp && Date.now() > obj.exp) return null;
    return obj;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers['x-session-token'];
  const session = verifyToken(token);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  if (session.r !== 'admin') return res.status(403).json({ error: 'Admin only' });

  let kv;
  try {
    ({ kv } = await import('@vercel/kv'));
  } catch {
    return res.status(200).json({ kvConfigured: false, users: [], totals: null, recent: [], budget: null });
  }

  // Admin action: re-arm the budget alert after topping up credit.
  if (req.method === 'POST' && (req.body || {}).action === 'resetBudgetAlert') {
    try { await kv.del('opticai:budgetAlertSent'); return res.status(200).json({ ok: true, rearmed: true }); }
    catch (e) { return res.status(200).json({ ok: false, error: e.message }); }
  }

  try {
    const usernames = await kv.smembers('opticai:users');
    const users = [];
    let tCalls = 0, tIn = 0, tOut = 0, tMicros = 0;

    for (const u of usernames || []) {
      const h = (await kv.hgetall(`opticai:usage:${u}`)) || {};
      const calls = Number(h.calls || 0);
      const inputTokens = Number(h.inputTokens || 0);
      const outputTokens = Number(h.outputTokens || 0);
      const costMicros = Number(h.costMicros || 0);
      const lastSeen = h.lastSeen || null;
      users.push({
        username: u,
        calls,
        inputTokens,
        outputTokens,
        costUSD: costMicros / 1e6,
        lastSeen,
      });
      tCalls += calls; tIn += inputTokens; tOut += outputTokens; tMicros += costMicros;
    }

    users.sort((a, b) => b.costUSD - a.costUSD);

    let recent = [];
    try {
      const raw = await kv.lrange('opticai:usagelog', 0, 49);
      recent = (raw || []).map((r) => (typeof r === 'string' ? JSON.parse(r) : r));
    } catch { /* log optional */ }

    let budget = null;
    if (API_BUDGET_USD > 0) {
      const gm = Number((await kv.get('opticai:totalCostMicros')) || tMicros);
      const spentUSD = gm / 1e6;
      const armed = !(await kv.get('opticai:budgetAlertSent'));
      budget = {
        budgetUSD: API_BUDGET_USD,
        spentUSD,
        remainingUSD: API_BUDGET_USD - spentUSD,
        thresholdUSD: API_ALERT_REMAINING_USD,
        alertArmed: armed,
      };
    }

    return res.status(200).json({
      kvConfigured: true,
      users,
      totals: { calls: tCalls, inputTokens: tIn, outputTokens: tOut, costUSD: tMicros / 1e6 },
      recent,
      budget,
    });
  } catch (err) {
    console.error('usage read error:', err.message);
    return res.status(200).json({ kvConfigured: false, users: [], totals: null, recent: [], error: err.message });
  }
}
