/**
 * Gera dois HTMLs de preview da DANFE — um pra NF-e (A4) e outro pra NFC-e (bobina).
 * Usa dados fake em memória, não toca no Supabase nem na SEFAZ.
 *
 * Saídas:
 *   C:\Users\felip\Desktop\preview-danfe-nfe.html
 *   C:\Users\felip\Desktop\preview-danfe-nfce.html
 *
 * Rode com:  npm run preview:danfe   (ou tsx scripts/preview-danfe.ts)
 */

import { writeFile } from 'node:fs/promises'
import {
  renderDanfeNfeFromData,
  renderDanfeNfceFromData,
  type DanfeData,
} from '../src/services/nfe/danfe.js'

const empresa = {
  razao_social: 'ÓTICA EXEMPLO LTDA',
  cnpj: '12345678000199',
  ie: '060000000',
  endereco_logradouro: 'Rua das Flores',
  endereco_numero: '123',
  endereco_bairro: 'Centro',
  endereco_cidade: 'GROAÍRAS',
  endereco_uf: 'CE',
  endereco_cep: '62170000',
}

const cliente = {
  nome: 'JOÃO DA SILVA',
  cpf_cnpj: '12345678909',
  endereco_logradouro: 'Av. Brasil',
  endereco_numero: '500',
  endereco_bairro: 'Aldeota',
  endereco_cidade: 'FORTALEZA',
  endereco_uf: 'CE',
  endereco_cep: '60150000',
}

const itens = [
  {
    numero_item: 1,
    codigo_produto: 'OCULOS-RB-001',
    descricao: 'ÓCULOS DE GRAU RAY-BAN RB5228 - ARMAÇÃO PLÁSTICA',
    ncm: '90031100',
    cfop: '5102',
    unidade_comercial: 'PC',
    quantidade_comercial: 1,
    valor_unitario: 450.0,
    valor_total: 450.0,
    valor_desconto: 0,
    gtin: 'SEM GTIN',
  },
  {
    numero_item: 2,
    codigo_produto: 'LENTE-MULTI-001',
    descricao: 'LENTE OFTÁLMICA MULTIFOCAL ANTIRREFLEXO',
    ncm: '90015000',
    cfop: '5102',
    unidade_comercial: 'PAR',
    quantidade_comercial: 1,
    valor_unitario: 280.0,
    valor_total: 280.0,
    valor_desconto: 30.0,
    gtin: 'SEM GTIN',
  },
]

const notaNfe = {
  numero: 1,
  serie: 1,
  modelo: 55,
  ambiente_nfe: 2, // homologação
  status: 'autorizada',
  protocolo: '123456789012345',
  chave_acesso: '23260512345678000199550010000000011000000017',
  valor_produtos: 730.0,
  valor_desconto: 30.0,
  valor_frete: 0,
  valor_icms: 0,
  valor_ipi: 0,
  valor_outras_despesas: 0,
  valor_total: 700.0,
  valor_pago: 700.0,
  troco: 0,
  forma_pagamento: '03', // cartão crédito
  info_complementar: 'Documento emitido por ME ou EPP optante pelo Simples Nacional. Não gera direito a crédito fiscal de ICMS, ISS e IPI.',
  data_autorizacao: new Date().toISOString(),
}

const notaNfce = {
  ...notaNfe,
  numero: 1042,
  modelo: 65,
  forma_pagamento: '17', // PIX
  qr_code_nfce:
    'https://nfceh.sefaz.ce.gov.br/pages/consultaNFCe.jsf?p=23260512345678000199650010000010421000000017|2|2|1|abc123def456',
}

async function main() {
  const dataNfe: DanfeData = { empresa, cliente, nota: notaNfe, itens }
  const dataNfce: DanfeData = { empresa, nota: notaNfce, itens }

  const htmlNfe = await renderDanfeNfeFromData(dataNfe)
  const htmlNfce = await renderDanfeNfceFromData(dataNfce)

  const out1 = 'C:\\Users\\felip\\Desktop\\preview-danfe-nfe.html'
  const out2 = 'C:\\Users\\felip\\Desktop\\preview-danfe-nfce.html'

  await writeFile(out1, htmlNfe, 'utf-8')
  await writeFile(out2, htmlNfce, 'utf-8')

  console.log('Preview gerado:')
  console.log('  NF-e  (A4)     →', out1)
  console.log('  NFC-e (bobina) →', out2)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
