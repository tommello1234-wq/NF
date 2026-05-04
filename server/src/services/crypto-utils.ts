import crypto from 'node:crypto'
import { config } from '../config.js'

/**
 * AES-256-GCM helpers reutilizando a CERT_ENCRYPTION_KEY que já existe no projeto.
 * Use pra cifrar segredos curtos persistidos no banco (senha de PFX, tokens
 * de webhook etc). NÃO use pra payloads grandes — overhead.
 *
 * Formato cifrado: "<ivBase64>.<authTagBase64>.<cipherTextBase64>"
 */

const ALG = 'aes-256-gcm'
const KEY = Buffer.from(config.cert.encryptionKey, 'hex')
if (KEY.length !== 32) {
  throw new Error('CERT_ENCRYPTION_KEY deve ter 64 caracteres hex (32 bytes)')
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALG, KEY, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('base64')}.${authTag.toString('base64')}.${encrypted.toString('base64')}`
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, ctB64] = payload.split('.')
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Formato cifrado inválido')
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(tagB64, 'base64')
  const ct = Buffer.from(ctB64, 'base64')
  const decipher = crypto.createDecipheriv(ALG, KEY, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

/** Comparação constant-time pra evitar timing attacks na validação de token */
export function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}
