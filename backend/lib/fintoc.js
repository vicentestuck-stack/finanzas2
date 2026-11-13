const FINTOC_BASE = 'https://api.fintoc.com/v1';

async function fintocRequest(path, { method = 'GET', query, body } = {}) {
  const url = new URL(FINTOC_BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url, {
    method,
    headers: {
      // Fintoc takes the raw secret key in this header, no "Bearer" prefix.
      Authorization: process.env.FINTOC_SECRET_KEY,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (json && json.error && json.error.message) || `Fintoc ${method} ${path} failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.fintoc = json;
    throw err;
  }
  return json;
}

// Step 1 of the connect flow: creates a Link Intent. Its widget_token is
// only ever returned here — the PWA uses it to open the Fintoc widget.
function createLinkIntent({ holderType = 'individual', country = 'cl' } = {}) {
  return fintocRequest('/link_intents', {
    method: 'POST',
    body: { country, holder_type: holderType, product: 'movements' },
  });
}

// Step 2: once the widget succeeds, the frontend hands us its exchangeToken.
// This call is the only place the link_token (which can read the user's
// real transactions) is ever revealed — never send it back to the browser.
function exchangeLink(exchangeToken) {
  return fintocRequest('/links/exchange', { query: { exchange_token: exchangeToken } });
}

function listMovements(accountId, linkToken, { since, page = 1 } = {}) {
  return fintocRequest(`/accounts/${accountId}/movements`, {
    query: { link_token: linkToken, since, page, per_page: 300 },
  });
}

module.exports = { createLinkIntent, exchangeLink, listMovements };
