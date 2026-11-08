'use strict';

const { createClient } = require('@supabase/supabase-js');

function createSupabaseClient({ url, secretKey }) {
  return createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { 'x-application-name': 'kingmc-worker-manager' } }
  });
}

module.exports = { createSupabaseClient };
