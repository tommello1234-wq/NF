import { createClient } from '@supabase/supabase-js'
import { config } from '../config.js'

/**
 * Cliente Supabase com service_role.
 * ATENÇÃO: service_role ignora RLS. Usar apenas em código do servidor.
 */
export const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)
