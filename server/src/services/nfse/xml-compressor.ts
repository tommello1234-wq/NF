import zlib from 'node:zlib'

/**
 * GZip + Base64 — formato exigido pela API do Padrão Nacional NFS-e
 * pra envio do XML DPS.
 */
export function compressGzipBase64(xml: string): string {
  return zlib.gzipSync(Buffer.from(xml, 'utf-8'), { level: 9 }).toString('base64')
}

export function decompressGzipBase64(b64: string): string {
  return zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf-8')
}
