const { supabaseAdmin } = require('../../lib/supabaseAdmin');
const { sendPush } = require('../../lib/webpush');

// Runs once a day (see vercel.json's crons entry). Mirrors — deliberately
// re-implemented in plain Node, not shared with the PWA's client-side JS —
// the same budget/goal/recurring math from pwa/index.html, against the raw
// `state` jsonb each user's user_state row holds, and pushes a notification
// for anything newly true. sent_alerts (user_id, alert_key) is the dedupe
// ledger: each condition gets a key that only changes when the underlying
// fact changes (e.g. the month, or the recurring item's date), so the same
// alert is never sent twice for the same occurrence.

function monthKey(iso) { return (iso || '').slice(0, 7); }
function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function shiftMonthKey(mk, delta) {
  const parts = mk.split('-');
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function categorySpend(transactions, categoryId, mk) {
  let sum = 0;
  for (const t of transactions) {
    if (t.isTransfer) continue;
    if (t.categoryId !== categoryId) continue;
    if (monthKey(t.date) !== mk) continue;
    if (t.amount < 0) sum += Math.abs(t.amount);
  }
  return sum;
}
function effectiveBudgetCap(state, categoryId, mk) {
  const b = (state.budgets || []).find(x => x.categoryId === categoryId && x.month === mk);
  if (!b) return 0;
  let cap = b.cap;
  if (state.settings && state.settings.budgetRollover) {
    const prevMk = shiftMonthKey(mk, -1);
    const prevB = (state.budgets || []).find(x => x.categoryId === categoryId && x.month === prevMk);
    if (prevB) cap += prevB.cap - categorySpend(state.transactions || [], categoryId, prevMk);
  }
  return Math.max(0, cap);
}
function fmt(n) { return '$' + Math.round(n).toLocaleString('es-CL'); }

// Builds the list of {key, title, body} alerts currently true for this user's state.
function computeAlerts(state) {
  const alerts = [];
  const mk = monthKey(todayISO());
  const today = todayISO();
  const categories = state.categories || [];
  const catName = id => { const c = categories.find(x => x.id === id); return c ? c.name : id; };

  for (const b of (state.budgets || [])) {
    if (b.month !== mk) continue;
    const cap = effectiveBudgetCap(state, b.categoryId, mk);
    if (cap <= 0) continue;
    const spend = categorySpend(state.transactions || [], b.categoryId, mk);
    const pct = spend / cap;
    if (pct >= 1) {
      alerts.push({ key: `budget_over:${b.categoryId}:${mk}`, title: 'Presupuesto superado', body: `${catName(b.categoryId)}: gastaste ${fmt(spend)} de ${fmt(cap)} este mes.` });
    } else if (pct >= 0.8) {
      alerts.push({ key: `budget_warn:${b.categoryId}:${mk}`, title: 'Cerca del límite de presupuesto', body: `${catName(b.categoryId)}: llevas ${fmt(spend)} de ${fmt(cap)} este mes.` });
    }
  }

  for (const g of (state.goals || [])) {
    if (!g.dueDate) continue;
    const remaining = Math.max(0, (g.target || 0) - (g.saved || 0));
    if (remaining <= 0) continue;
    const daysLeft = Math.ceil((new Date(g.dueDate + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
    if (daysLeft < 0) {
      alerts.push({ key: `goal_overdue:${g.id}:${mk}`, title: 'Meta vencida', body: `${g.name}: venció y aún te faltan ${fmt(remaining)}.` });
    } else if (daysLeft <= 7) {
      alerts.push({ key: `goal_due:${g.id}`, title: 'Meta por vencer', body: `${g.name}: vence pronto y te faltan ${fmt(remaining)}.` });
    }
  }

  const tomorrow = shiftDays(today, 1);
  for (const r of (state.recurring || [])) {
    if (r.active === false) continue;
    if (r.nextDate === tomorrow) {
      alerts.push({ key: `recurring_due:${r.id}:${r.nextDate}`, title: 'Pago recurrente mañana', body: `${r.description || 'Movimiento recurrente'}: se registra solo mañana por ${fmt(Math.abs(r.amount))}.` });
    }
  }

  return alerts;
}
function shiftDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

module.exports = async (req, res) => {
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const db = supabaseAdmin();
  const { data: rows, error } = await db.from('user_state').select('user_id, state');
  if (error) return res.status(500).json({ error: 'db_error', message: error.message });

  let usersChecked = 0, alertsSent = 0, pushesSent = 0, pushesFailed = 0;

  for (const row of rows || []) {
    usersChecked++;
    const state = row.state || {};
    const alerts = computeAlerts(state);
    if (!alerts.length) continue;

    const { data: already } = await db.from('sent_alerts').select('alert_key').eq('user_id', row.user_id);
    const alreadySet = new Set((already || []).map(x => x.alert_key));
    const fresh = alerts.filter(a => !alreadySet.has(a.key));
    if (!fresh.length) continue;

    const { data: subs } = await db.from('push_subscriptions').select('*').eq('user_id', row.user_id);
    for (const alert of fresh) {
      alertsSent++;
      for (const sub of subs || []) {
        const result = await sendPush(sub, { title: alert.title, body: alert.body });
        if (result.ok) pushesSent++;
        else {
          pushesFailed++;
          if (result.gone) await db.from('push_subscriptions').delete().eq('id', sub.id);
        }
      }
      await db.from('sent_alerts').upsert({ user_id: row.user_id, alert_key: alert.key });
    }
  }

  res.status(200).json({ usersChecked, alertsSent, pushesSent, pushesFailed });
};
