import crypto from 'node:crypto'
import forge from 'node-forge'
import { supabase } from './supabase.js'
import { config } from '../config.js'

/**
 * Certificados digitais A1 (.pfx) por empresa, com:
 * - PFX no Supabase Storage (bucket privado 'certificados')
 * - Senha criptografada AES-256-GCM na tabela 'certificados_digitais'
 * - Chave de cripto fica só em env var (CERT_ENCRYPTION_KEY)
 */

const ALG = 'aes-256-gcm'
const KEY = Buffer.from(config.cert.encryptionKey, 'hex')

if (KEY.length !== 32) {
  throw new Error('CERT_ENCRYPTION_KEY deve ter 64 caracteres hex (32 bytes)')
}

function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALG, KEY, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('base64')}.${authTag.toString('base64')}.${encrypted.toString('base64')}`
}

function decrypt(payload: string): string {
  const [ivB64, tagB64, ctB64] = payload.split('.')
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Formato criptografado inválido')
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(tagB64, 'base64')
  const ct = Buffer.from(ctB64, 'base64')
  const decipher = crypto.createDecipheriv(ALG, KEY, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

export interface CertificadoInfo {
  cnpj: string
  razaoSocial: string
  validoAte: Date
  serialNumber: string
}

export function lerMetadadosPfx(pfxBuffer: Buffer, senha: string): CertificadoInfo | null {
  try {
    const p12Der = forge.util.createBuffer(pfxBuffer.toString('binary'))
    const p12Asn1 = forge.asn1.fromDer(p12Der)
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, senha)

    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })
    const certBag = certBags[forge.pki.oids.certBag]?.[0]
    if (!certBag || !certBag.cert) return null

    const cert = certBag.cert
    const cnField = cert.subject.getField('CN')
    const cn: string = cnField?.value || ''
    const match = cn.match(/:(\d{14})$/)
    const cnpj = match ? match[1] : ''
    const razaoSocial = cn.replace(/:\d{14}$/, '').trim()

    return {
      cnpj,
      razaoSocial,
      validoAte: cert.validity.notAfter,
      serialNumber: cert.serialNumber,
    }
  } catch {
    return null
  }
}

export async function salvarCertificado(params: {
  empresaId: string
  pfxBuffer: Buffer
  senha: string
  info: CertificadoInfo
}) {
  const { empresaId, pfxBuffer, senha, info } = params
  const storagePath = `${empresaId}/certificado.pfx`

  const { error: upErr } = await supabase.storage
    .from('certificados')
    .upload(storagePath, pfxBuffer, {
      upsert: true,
      contentType: 'application/x-pkcs12',
    })
  if (upErr) throw new Error(`Erro ao fazer upload do PFX: ${upErr.message}`)

  const senhaCript = encrypt(senha)

  const { error: dbErr } = await supabase
    .from('certificados_digitais')
    .upsert({
      empresa_id: empresaId,
      cnpj: info.cnpj,
      razao_social: info.razaoSocial,
      valido_ate: info.validoAte.toISOString(),
      serial_number: info.serialNumber,
      storage_path: storagePath,
      senha_criptografada: senhaCript,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: 'empresa_id' })

  if (dbErr) throw new Error(`Erro ao salvar metadados: ${dbErr.message}`)
}

export async function carregarCertificado(empresaId: string): Promise<{
  pfxBuffer: Buffer
  senha: string
  info: CertificadoInfo
} | null> {
  const { data: meta } = await supabase
    .from('certificados_digitais')
    .select('*')
    .eq('empresa_id', empresaId)
    .maybeSingle()

  if (!meta) return null

  const { data: file, error } = await supabase.storage
    .from('certificados')
    .download(meta.storage_path)

  if (error || !file) throw new Error(`Erro ao baixar PFX: ${error?.message}`)

  const pfxBuffer = Buffer.from(await file.arrayBuffer())
  const senha = decrypt(meta.senha_criptografada)

  return {
    pfxBuffer,
    senha,
    info: {
      cnpj: meta.cnpj,
      razaoSocial: meta.razao_social,
      validoAte: new Date(meta.valido_ate),
      serialNumber: meta.serial_number,
    },
  }
}

export async function statusCertificado(empresaId: string) {
  const { data } = await supabase
    .from('certificados_digitais')
    .select('cnpj, razao_social, valido_ate, serial_number, atualizado_em')
    .eq('empresa_id', empresaId)
    .maybeSingle()

  if (!data) return null

  const validoAte = new Date(data.valido_ate)
  const diasRestantes = Math.floor((validoAte.getTime() - Date.now()) / (1000 * 60 * 60 * 24))

  return {
    cnpj: data.cnpj,
    razaoSocial: data.razao_social,
    validoAte: data.valido_ate,
    serialNumber: data.serial_number,
    diasRestantes,
    status: diasRestantes < 0 ? 'vencido' : diasRestantes < 30 ? 'vencendo' : 'valido',
  }
}

export async function removerCertificado(empresaId: string) {
  const { data: meta } = await supabase
    .from('certificados_digitais')
    .select('storage_path')
    .eq('empresa_id', empresaId)
    .maybeSingle()

  if (meta?.storage_path) {
    await supabase.storage.from('certificados').remove([meta.storage_path])
  }

  await supabase.from('certificados_digitais').delete().eq('empresa_id', empresaId)
}
