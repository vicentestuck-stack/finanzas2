const { withCors } = require('../../lib/cors');
const { requireUser } = require('../../lib/auth');
const { exchangeLink } = require('../../lib/fintoc');
const { supabaseAdmin } = require('../../lib/supabaseAdmin');

function mapAccountType(fintocType) {
  if (fintocType === 'savings_account') return 'savings';
  if (fintocType === 'credit_card') return 'credit_card';
  return 'checking'; // checking_account, sight_account, line_of_credit
}

module.exports = async (req, res) => {
  if (withCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  const { exchangeToken } = req.body || {};
  if (!exchangeToken) return res.status(400).json({ error: 'missing_exchange_token' });

  try {
    const link = await exchangeLink(exchangeToken);
    const db = supabaseAdmin();

    const { data: connection, error: connErr } = await db
      .from('bank_connections')
      .insert({
        user_id: user.id,
        provider: 'fintoc',
        provider_link_id: link.id,
        link_token: link.link_token,
        institution_name: link.institution.name,
        status: 'active',
      })
      .select()
      .single();
    if (connErr) throw connErr;

    const accountsPayload = (link.accounts || []).map((a) => ({
      bank_connection_id: connection.id,
      user_id: user.id,
      provider_account_id: a.id,
      type: mapAccountType(a.type),
      last4: a.number ? a.number.slice(-4) : null,
      currency: a.currency || 'CLP',
      current_balance_cents: a.balance ? a.balance.current : 0,
    }));
    if (accountsPayload.length) {
      const { error: accErr } = await db.from('accounts').insert(accountsPayload);
      if (accErr) throw accErr;
    }

    res.status(200).json({
      bankConnectionId: connection.id,
      institutionName: link.institution.name,
      accountCount: accountsPayload.length,
      status: 'active',
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'fintoc_error', message: err.message });
  }
};
