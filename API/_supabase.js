// api/_supabase.js
// Cliente único de Supabase usando la SERVICE ROLE KEY.
// Este archivo NUNCA debe importarse desde el frontend.
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[supabase] Faltan variables de entorno SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

module.exports = { supabase };
