const { withCors } = require('../../lib/cors');
const { requireUser } = require('../../lib/auth');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

// Marks the connection disconnected on our side so we stop syncing it.
// Fintoc keeps the link itself; fully revoking it from Fintoc's side is a
// follow-up (check the current "deactivate a link" endpoint in their docs
// before shipping this to real users).
module.exports = async (req, res) => {
  if (withCors(req, res)) return;
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'method_not_allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  const { bankConnectionId } = req.body || {};
  if (!bankConnectionId) return res.status(400).json({ error: 'missing_bank_connection_id' });

  const { error } = await supabaseAdmin()
    .from('bank_connections')
    .update({ status: 'disconnected' })
    .eq('id', bankConnectionId)
    .eq('user_id', user.id);
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });

  res.status(200).json({ status: 'disconnected' });
};
