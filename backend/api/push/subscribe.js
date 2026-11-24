const { withCors } = require('../../lib/cors');
const { requireUser } = require('../../lib/auth');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

// POST { endpoint, keys: { p256dh, auth } } — stores (or, on DELETE, removes)
// this device's push subscription so the daily alert cron can reach it.
module.exports = async (req, res) => {
  if (withCors(req, res)) return;
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === 'POST') {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return res.status(400).json({ error: 'invalid_subscription' });
    }
    const { error } = await supabaseAdmin()
      .from('push_subscriptions')
      .upsert({ user_id: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth }, { onConflict: 'endpoint' });
    if (error) return res.status(500).json({ error: 'db_error', message: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: 'missing_endpoint' });
    const { error } = await supabaseAdmin()
      .from('push_subscriptions')
      .delete()
      .eq('user_id', user.id)
      .eq('endpoint', endpoint);
    if (error) return res.status(500).json({ error: 'db_error', message: error.message });
    return res.status(200).json({ ok: true });
  }

  res.status(405).json({ error: 'method_not_allowed' });
};
