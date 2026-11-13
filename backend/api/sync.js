const { withCors } = require('../lib/cors');
const { requireUser } = require('../lib/auth');
const { listMovements } = require('../lib/fintoc');
const { supabaseAdmin } = require('../lib/supabaseAdmin');

const MAX_PAGES_PER_ACCOUNT = 10; // safety cap: 10 * 300 = 3000 movements per account per sync
const DEFAULT_LOOKBACK_DAYS = 90;

function isoDateDaysAgo(days) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  if (withCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  const db = supabaseAdmin();

  try {
    const { data: connections, error: connErr } = await db
      .from('bank_connections')
      .select('id, link_token, last_synced_at, accounts(id, provider_account_id)')
      .eq('user_id', user.id)
      .eq('status', 'active');
    if (connErr) throw connErr;

    let newCount = 0;

    for (const conn of connections || []) {
      const since = conn.last_synced_at
        ? conn.last_synced_at.slice(0, 10)
        : isoDateDaysAgo(DEFAULT_LOOKBACK_DAYS);

      for (const account of conn.accounts || []) {
        let page = 1;
        let movements = [];
        // Fintoc paginates at 300/page; keep pulling until a short page or the cap.
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const batch = await listMovements(account.provider_account_id, conn.link_token, { since, page });
          movements = movements.concat(batch);
          if (batch.length < 300 || page >= MAX_PAGES_PER_ACCOUNT) break;
          page += 1;
        }
        if (!movements.length) continue;

        const rows = movements.map((m) => ({
          account_id: account.id,
          user_id: user.id,
          provider_transaction_id: m.id,
          posted_at: m.post_date,
          amount_cents: m.amount,
          currency: m.currency,
          raw_description: m.description,
          source: 'bank_sync',
        }));
        const { error: upsertErr } = await db
          .from('transactions')
          .upsert(rows, { onConflict: 'account_id,provider_transaction_id', ignoreDuplicates: false });
        if (upsertErr) throw upsertErr;
        newCount += rows.length;
      }

      await db.from('bank_connections').update({ last_synced_at: new Date().toISOString() }).eq('id', conn.id);
    }

    const { data: transactions, error: txErr } = await db
      .from('transactions')
      .select('id, amount_cents, raw_description, clean_description, posted_at, source')
      .eq('user_id', user.id)
      .order('posted_at', { ascending: false })
      .limit(1000);
    if (txErr) throw txErr;

    res.status(200).json({
      syncedAt: new Date().toISOString(),
      touched: newCount,
      transactions: (transactions || []).map((t) => ({
        id: t.id,
        amount: t.amount_cents,
        description: t.clean_description || t.raw_description,
        date: t.posted_at.slice(0, 10),
        source: t.source,
      })),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'sync_error', message: err.message });
  }
};
