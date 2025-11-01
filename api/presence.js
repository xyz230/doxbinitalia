// api/presence.js
export default async function handler(req, res) {
  // ✅ CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  // ✅ IP del client (da proxy Vercel)
  const forwarded = req.headers['x-forwarded-for'] || '';
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0]) || req.socket.remoteAddress;

  try {
    if (req.method === 'POST') {
      const { session_id, user_agent, send_ip_hash } = req.body || {};
      if (!session_id) return res.status(400).json({ error: 'session_id required' });

      const payload = {
        session_id,
        ip: send_ip_hash ? null : ip,
        ip_hash: send_ip_hash ? (req.body.ip_hash || null) : null,
        user_agent: user_agent || req.headers['user-agent'] || null,
        last_seen: new Date().toISOString()
      };

      const resp = await fetch(`${SUPABASE_URL}/rest/v1/presence?on_conflict=session_id`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify(payload)
      });

      const data = await resp.json();
      if (!resp.ok) return res.status(resp.status).json({ error: data });
      return res.status(200).json({ ok: true, data });
    }

    if (req.method === 'GET') {
      const activeSeconds = parseInt(req.query.activeSeconds || '15', 10);
      const since = new Date(Date.now() - activeSeconds * 1000).toISOString();

      const resp = await fetch(`${SUPABASE_URL}/rest/v1/presence?select=session_id,ip,ip_hash,last_seen&last_seen=gt.${encodeURIComponent(since)}`, {
        method: 'GET',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        }
      });

      const rows = await resp.json();
      if (!resp.ok) return res.status(resp.status).json({ error: rows });

      const uniqueIps = [...new Set(rows.map(r => r.ip).filter(Boolean))];
      const uniqueHashes = [...new Set(rows.map(r => r.ip_hash).filter(Boolean))];

      return res.status(200).json({
        count: uniqueIps.length || uniqueHashes.length,
        ips: uniqueIps,
        hashes: uniqueHashes,
        raw: rows
      });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('presence error', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
}
