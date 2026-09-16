/**
 * Renderiza a DANFE a partir de um XML autorizado, sem passar pelo banco.
 *
 * Serve pra conferir o que o contador vai receber antes de subir mudança no
 * layout: baixe o XML da nota (GET /v1/nfe/:id/xml) e rode aqui.
 *
 *   npx tsx scripts/preview-danfe-do-xml.ts nota.xml saida.html
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { overlayDoXmlAutorizado } from '../src/services/nfe/danfe-xml.js'
import { renderDanfeNfeFromData, renderDanfeNfceFromData } from '../src/services/nfe/danfe.js'
import { supabase } from '../src/services/supabase.js'

const [, , entrada, saida] = process.argv
if (!entrada || !saida) {
  console.error('uso: tsx scripts/preview-danfe-do-xml.ts <nota.xml> <saida.html>')
  process.exit(1)
}

const overlay = overlayDoXmlAutorizado(readFileSync(entrada, 'utf-8'))
if (!overlay) {
  console.error('XML não parece uma NF-e/NFC-e.')
  process.exit(1)
}

// O emitente não está no overlay (a DANFE lê da tabela de empresas); busca
// pelo CNPJ do próprio XML.
const cnpjEmit = /<emit>.*?<CNPJ>(\d+)<\/CNPJ>/s.exec(readFileSync(entrada, 'utf-8'))?.[1]
const { data: empresa } = await supabase
  .from('empresas')
  .select('*')
  .eq('cnpj', cnpjEmit)
  .maybeSingle()
if (!empresa) {
  console.error(`Empresa com CNPJ ${cnpjEmit} não encontrada.`)
  process.exit(1)
}

const data = { empresa, cliente: overlay.cliente, nota: overlay.nota, itens: overlay.itens }
const html =
  Number(overlay.nota.modelo) === 65
    ? await renderDanfeNfceFromData(data)
    : await renderDanfeNfeFromData(data)

writeFileSync(saida, html)
console.log(`DANFE de ${overlay.nota.natureza_operacao} escrita em ${saida}`)
