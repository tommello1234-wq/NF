import { createClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string) || 'https://yfkkitbnlvbfzgbxyhmn.supabase.co'
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || 'sb_publishable_jCbn5xTva79AUdpUydpkKg_k7XajKt0'

if (!url || !anonKey) {
  console.error('VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY não definidos no .env')
}

export const supabase = createClient(url, anonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
})
