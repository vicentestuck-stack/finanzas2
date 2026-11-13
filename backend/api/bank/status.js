const { withCors } = require('../../lib/cors');
const { requireUser } = require('../../lib/auth');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

module.exports = async (req, res) => {
  if (withCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  const { data, error } = await supabaseAdmin()
    .from('bank_connections')
    .select('id, institution_name, status, last_synced_at')
    .eq('user_id', user.id)
    .eq('status', 'active');
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });

  res.status(200).json({ connections: data || [] });
};
