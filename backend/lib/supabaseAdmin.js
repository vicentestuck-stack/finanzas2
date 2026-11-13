const { createClient } = require('@supabase/supabase-js');

let client = null;

// Service-role client: bypasses RLS, so every function that uses it MUST
// scope its own queries by the verified user id from requireUser(). Never
// forward this key to the browser.
function supabaseAdmin() {
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return client;
}

module.exports = { supabaseAdmin };
