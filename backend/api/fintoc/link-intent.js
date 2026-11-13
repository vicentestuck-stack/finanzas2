const { withCors } = require('../../lib/cors');
const { requireUser } = require('../../lib/auth');
const { createLinkIntent } = require('../../lib/fintoc');

module.exports = async (req, res) => {
  if (withCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const linkIntent = await createLinkIntent({ holderType: 'individual' });
    // widget_token is short-lived and only used client-side to open the
    // widget; it cannot read any transaction data by itself.
    res.status(200).json({ widgetToken: linkIntent.widget_token });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'fintoc_error', message: err.message });
  }
};
