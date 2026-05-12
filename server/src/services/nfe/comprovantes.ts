/**
 * Geradores de comprovantes/visualizações por nota fiscal.
 *
 * Cada nota autorizada tem:
 *   - DANFE (em danfe.ts) — vista impressa
 *   - XML autorizado (nfeProc) — documento fiscal oficial, salvo no Storage
 *   - XML pré-envio (NFe assinada) — antes do protocolo, salvo no Storage
 *   - Comprovante de autorização SEFAZ — gerado a partir do retorno
 *   - QR Code standalone PNG (só NFC-e)
 *   - Comprovantes de eventos (CC-e, cancelamento, inutilização)
 */

import QRCode from 'qrcode'
import { supabase } from '../supabase.js'

/** Baixa um arquivo do Storage e devolve como Buffer + filename sugerido. */
export async function baixarArquivoStorage(
  bucket: string,
  path: string,
): Promise<{ buffer: Buffer; filename: string } | null> {
  const { data, error } = await supabase.storage.from(bucket).download(path)
  if (error || !data) return null
  const arr = new Uint8Array(await data.arrayBuffer())
  return {
    buffer: Buffer.from(arr),
    filename: path.split('/').pop() || 'arquivo.xml',
  }
}

/** Gera um HTML pretty com os dados do retorno SEFAZ (comprovante de autorização). */
export function renderComprovanteAutorizacao(params: {
  empresa: { razao_social?: string; cnpj?: string; ie?: string }
  nota: {
    numero?: number | null
    serie?: number | null
    modelo?: number | null
    chave_acesso?: string | null
    protocolo?: string | null
    data_autorizacao?: string | null
    valor_total?: number | string | null
    ambiente_nfe?: number | null
    status?: string | null
    mensagens_retorno?: Record<string, unknown> | null
  }
}): string {
  const e = params.empresa
  const n = params.nota
  const ambiente = Number(n.ambiente_nfe ?? 2) === 1 ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO'
  const dh = n.data_autorizacao ? new Date(String(n.data_autorizacao)).toLocaleString('pt-BR') : '—'
  const ret = (n.mensagens_retorno as { cStat?: string; xMotivo?: string } | null) ?? {}
  const cStat = ret.cStat || (n.status === 'autorizada' ? '100' : '—')
  const xMotivo = ret.xMotivo || (n.status === 'autorizada' ? 'Autorizado o uso da NF-e' : n.status || '—')
  const modelo = Number(n.modelo) === 65 ? 'NFC-e (mod 65)' : 'NF-e (mod 55)'

  const chaveFmt = (n.chave_acesso || '').replace(/\D/g, '').match(/.{1,4}/g)?.join(' ') || '—'

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Comprovante de Autorização — ${escape(n.numero || '')}</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { font: 12px 'Segoe UI', Arial, sans-serif; color: #1a1a1a; margin: 0; }
  .doc { max-width: 174mm; margin: 0 auto; }
  h1 { font-size: 18px; margin: 0 0 4mm; color: #0f172a; }
  .stamp {
    display: inline-block; padding: 2mm 4mm; border: 2px solid;
    font-weight: 700; letter-spacing: 1px; font-size: 13px;
  }
  .stamp.autorizada { border-color: #10b981; color: #10b981; }
  .stamp.homolog { border-color: #c00; color: #c00; margin-left: 6mm; }
  .blk { border: 1px solid #cbd5e1; border-radius: 6px; padding: 4mm; margin: 4mm 0; }
  .blk h3 { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin: 0 0 2mm; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
  .field { padding: 1mm 0; }
  .field .lbl { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px; }
  .field .val { font-size: 12px; font-weight: 600; color: #0f172a; }
  .field .val.mono { font-family: 'Consolas', monospace; }
  .footer { text-align: center; color: #94a3b8; font-size: 9px; margin-top: 10mm; }
</style>
</head>
<body>
<div class="doc">
  <h1>Comprovante de Autorização SEFAZ</h1>
  <div>
    <span class="stamp autorizada">${escape(cStat)} ${escape(xMotivo)}</span>
    ${ambiente === 'HOMOLOGAÇÃO' ? `<span class="stamp homolog">SEM VALOR FISCAL</span>` : ''}
  </div>

  <div class="blk">
    <h3>Emitente</h3>
    <div class="grid">
      <div class="field"><div class="lbl">Razão Social</div><div class="val">${escape(e.razao_social || '—')}</div></div>
      <div class="field"><div class="lbl">CNPJ</div><div class="val mono">${formatCnpj(e.cnpj || '')}</div></div>
      <div class="field"><div class="lbl">Inscrição Estadual</div><div class="val mono">${escape(e.ie || '—')}</div></div>
      <div class="field"><div class="lbl">Modelo</div><div class="val">${modelo}</div></div>
    </div>
  </div>

  <div class="blk">
    <h3>Documento</h3>
    <div class="grid">
      <div class="field"><div class="lbl">Número</div><div class="val">${escape(n.numero ?? '—')}</div></div>
      <div class="field"><div class="lbl">Série</div><div class="val">${escape(n.serie ?? '—')}</div></div>
      <div class="field"><div class="lbl">Valor Total</div><div class="val">${money(n.valor_total)}</div></div>
      <div class="field"><div class="lbl">Ambiente</div><div class="val">${ambiente}</div></div>
    </div>
    <div class="field"><div class="lbl">Chave de acesso (44 dígitos)</div><div class="val mono">${chaveFmt}</div></div>
  </div>

  <div class="blk">
    <h3>Resposta SEFAZ</h3>
    <div class="grid">
      <div class="field"><div class="lbl">cStat</div><div class="val mono">${escape(cStat)}</div></div>
      <div class="field"><div class="lbl">xMotivo</div><div class="val">${escape(xMotivo)}</div></div>
      <div class="field"><div class="lbl">Protocolo de Autorização</div><div class="val mono">${escape(n.protocolo || '—')}</div></div>
      <div class="field"><div class="lbl">Data/hora da Autorização</div><div class="val">${dh}</div></div>
    </div>
  </div>

  <div class="footer">
    Este documento é uma representação visual da autorização emitida pela SEFAZ.<br>
    A nota fiscal eletrônica é o XML autorizado (nfeProc) armazenado por 5 anos.
  </div>
</div>
</body>
</html>`
}

export async function gerarQrCodePngBuffer(url: string): Promise<Buffer> {
  return await QRCode.toBuffer(url, { errorCorrectionLevel: 'M', margin: 2, scale: 8 })
}

function escape(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function money(v: unknown): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0))
}

function formatCnpj(v: string): string {
  const d = v.replace(/\D/g, '')
  if (d.length !== 14) return v || '—'
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}
