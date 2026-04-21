import 'dotenv/config'

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Variável de ambiente obrigatória não definida: ${name}`)
  return v
}

export const config = {
  port: Number(process.env.PORT || 3001),
  nodeEnv: process.env.NODE_ENV || 'development',

  supabase: {
    url: required('SUPABASE_URL'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  },

  cert: {
    encryptionKey: required('CERT_ENCRYPTION_KEY'),
  },

  nfe: {
    ambiente: Number(process.env.NFE_AMBIENTE || 2) as 1 | 2,
    uf: process.env.NFE_UF || 'CE',
  },
}
