const { supabaseAdmin } = require('./supabaseAdmin');

// Reads the Supabase access token from "Authorization: Bearer <token>"
// (the PWA gets this token from supabase.auth signIn/signUp) and asks
// Supabase Auth to confirm who it belongs to. Returns the user or null —
// callers must respond 401 on null, never trust a client-supplied user id.
async function requireUser(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'missing_token' });
    return null;
  }
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data || !data.user) {
    res.status(401).json({ error: 'invalid_token' });
    return null;
  }
  return data.user;
}

module.exports = { requireUser };
