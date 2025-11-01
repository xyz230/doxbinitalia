// api/presence.js
export default async function handler(req, res) {
  // CORS semplice
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  // Read client IP (Vercel sets x-forwarded-for)
  const forwarded = req.headers['x-forwarded-for'] || '';
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0]) || req.socket.remoteAddress;

  try {
    if (req.method === 'POST') {
      // Heartbeat: upsert a row with session_id
      const { session_id, user_agent, send_ip_hash } = req.body || {};
      if (!session_id) return res.status(400).json({ error: 'session_id required' });

      // Optionally compute ip_hash here (if client asked to hide real IP)
      let ip_hash = null;
      if (send_ip_hash) {
        // If client asks to hash on server, you could compute hash here.
        // But to avoid extra libs, assume client sends ip_hash already
        ip_hash = req.body.ip_hash || null;
      }

      const payload = {
        session_id,
        ip: send_ip_hash ? null : ip,
        ip_hash: send_ip_hash ? (ip_hash || null) : null,
        user_agent: user_agent || req.headers['user-agent'] || null,
        last_seen: new Date().toISOString()
      };

      // Upsert via Supabase REST (on_conflict=session_id)
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
      // Query active sessions: last_seen within last N seconds
      const activeSeconds = parseInt(req.query.activeSeconds || '15', 10); // default 15s
      const since = new Date(Date.now() - activeSeconds * 1000).toISOString();

      // Use Supabase REST to select rows with last_seen > since
      // We need to URL-encode the filter: last_seen=gt.<since>
      const filter = `last_seen=gt.${encodeURIComponent(since)}`;

      const resp = await fetch(`${SUPABASE_URL}/rest/v1/presence?select=session_id,ip,ip_hash,last_seen&${filter}`, {
        method: 'GET',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        }
      });

      const rows = await resp.json();
      if (!resp.ok) return res.status(resp.status).json({ error: rows });

      // produce unique ip list (if ip present) or unique ip_hash list
      const ips = [];
      const ipHashes = [];
      rows.forEach(r => {
        if (r.ip) ips.push(r.ip);
        if (r.ip_hash) ipHashes.push(r.ip_hash);
      });

      const uniqueIps = Array.from(new Set(ips));
      const uniqueHashes = Array.from(new Set(ipHashes));

      // return both list and counts
      return res.status(200).json({
        count_ips: uniqueIps.length,
        ips: uniqueIps,
        count_hashes: uniqueHashes.length,
        ip_hashes: uniqueHashes,
        raw: rows
      });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('presence error', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
}
