// NOTE: No auth on this endpoint — it is an admin-only convenience endpoint
// for Santosh to review learned column mappings via browser/curl. Add
// token-based access control (e.g. verify admin role from x-session-token)
// before wider rollout.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let kv;
  try {
    ({ kv } = await import('@vercel/kv'));
  } catch {
    if (req.method === 'GET') return res.status(200).json({ entries: [], kvConfigured: false });
    return res.status(200).json({ ok: false, kvConfigured: false });
  }

  if (req.method === 'GET') {
    try {
      const raw = await kv.lrange('learned_mappings', 0, -1);
      const entries = (raw || []).map(r => (typeof r === 'string' ? JSON.parse(r) : r));
      return res.status(200).json({ entries });
    } catch (err) {
      return res.status(200).json({ entries: [], error: err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      await kv.lpush('learned_mappings', JSON.stringify(req.body));
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(200).json({ ok: false, error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
