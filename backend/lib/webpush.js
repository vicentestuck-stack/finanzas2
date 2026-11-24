const webpush = require('web-push');

let configured = false;
function ensureConfigured() {
  if (configured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  configured = true;
}

// Sends one push message. Returns { ok: true } or { ok: false, gone: true }
// when the subscription is dead (410/404 — the browser unsubscribed it, or
// the user cleared site data) so the caller can delete it instead of retrying.
async function sendPush(subscription, payload) {
  ensureConfigured();
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload)
    );
    return { ok: true };
  } catch (err) {
    const gone = err.statusCode === 404 || err.statusCode === 410;
    return { ok: false, gone, message: err.message };
  }
}

module.exports = { sendPush };
