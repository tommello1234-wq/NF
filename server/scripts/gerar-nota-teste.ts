/**
 * Gera UMA nota de teste com:
 *  - dados reais da empresa/produto/cliente que estão no Supabase (do seed)
 *  - chave de acesso válida (44 dígitos com cDV mod11)
 *  - status simulado de "autorizada" + protocolo + QR Code
 *  - DANFE HTML escrita no Desktop
 *  - abre automaticamente no browser
 *
 * NÃO transmite ao SEFAZ, NÃO consome numeração real, NÃO precisa de cert.
 *
 * Uso:
 *   npm run gerar:nota                 (default = NFC-e modelo 65)
 *   npm run gerar:nota -- 55           (NF-e A4)
 */

import { writeFile } from 'node:fs/promises'
import { exec } from 'node:child_process'
import { supabase } from '../src/services/supabase.js'
import { gerarChaveAcesso } from '../src/services/nfe/chave-acesso.js'
import {
  renderDanfeNfeFromData,
  renderDanfeNfceFromData,
  type DanfeData,
} from '../src/services/nfe/danfe.js'

async function main() {
  const modelo = (process.argv[2] === '55' ? 55 : 65) as 55 | 65
  console.log(`Gerando nota de teste — modelo ${modelo} (${modelo === 65 ? 'NFC-e bobina' : 'NF-e A4'})…`)

  const empresa = await carregarEmpresa()
  const produtos = await carregarProdutos(empresa.id)
  const cliente = await carregarCliente(empresa.id, modelo)

  // Garante CSC fake pra NFC-e (sem migration 014 vai pro csc_id legado).
  if (modelo === 65 && !empresa.csc_id && !empresa.csc_id_homol) {
    await garantirCscFake(empresa.id)
    empresa.csc_id = 'FAKE000001'
    empresa.csc_token = 'FAKE-TOKEN-HOMOLOGACAO-TESTE-LOCAL-32B'
  }

  const dataEmissao = new Date()
  const numero = (empresa.proximo_numero_nfce as number) || (empresa.proximo_numero_nfe as number) || 1
  const serie = modelo === 65 ? (empresa.serie_nfce as number) || 1 : (empresa.serie_nfe as number) || 1

  const { chave } = gerarChaveAcesso({
    uf: 'CE',
    dataEmissao,
    cnpjEmitente: String(empresa.cnpj),
    modelo,
    serie,
    numero,
    tipoEmissao: 1,
  })

  // Usa o produto cadastrado + 5 itens fictícios diversos (espelha o estilo da DANFE Luxottica).
  const itensCatalogo = [
    { codigo: 'OCULOS-RB-001', desc: 'OCULOS RAY-BAN K306 54 INJETADO FEMININO VISTA', ncm: '90031100', cst: '102', cfop: '5102', vunit: 118.66, aliqIcms: 7, aliqIpi: 3.25, ipi: 3.86 },
    { codigo: 'OCULOS-RB-002', desc: 'OCULOS RAY-BAN L339 53 ACETATO FEMININO VISTA', ncm: '90031100', cst: '102', cfop: '5102', vunit: 197.20, aliqIcms: 4, aliqIpi: 3.25, ipi: 6.41 },
    { codigo: 'OCULOS-AN-003', desc: 'OCULOS ARNETTE 27589A57 INJETADO MASCULINO SOL', ncm: '90041000', cst: '102', cfop: '5102', vunit: 201.65, aliqIcms: 7, aliqIpi: 9.75, ipi: 19.66 },
    { codigo: 'OCULOS-AN-004', desc: 'OCULOS ARNETTE 737 55 METAL MASCULINO VISTA', ncm: '90031910', cst: '102', cfop: '5102', vunit: 184.90, aliqIcms: 7, aliqIpi: 3.25, ipi: 6.01 },
    { codigo: 'LENTE-MULTI-005', desc: 'LENTE OFTALMICA MULTIFOCAL ANTIRREFLEXO', ncm: '90015000', cst: '102', cfop: '5102', vunit: 129.76, aliqIcms: 7, aliqIpi: 3.25, ipi: 4.22 },
  ]

  const produtoBase = produtos[0]
  const itens = itensCatalogo.map((it, idx) => {
    const qtd = 1
    const valorTotal = +(it.vunit * qtd).toFixed(2)
    const valorIcms = +(valorTotal * it.aliqIcms / 100).toFixed(2)
    return {
      numero_item: idx + 1,
      codigo_produto: idx === 0 ? produtoBase.codigo_interno || it.codigo : it.codigo,
      descricao: idx === 0 ? produtoBase.descricao : it.desc,
      ncm: idx === 0 ? produtoBase.ncm || it.ncm : it.ncm,
      cst_csosn: it.cst,
      cfop: it.cfop,
      unidade_comercial: idx === 0 ? produtoBase.unidade || 'PC' : 'PC',
      quantidade_comercial: qtd,
      valor_unitario: it.vunit,
      valor_total: valorTotal,
      valor_desconto: 0,
      base_calculo_icms: valorTotal,
      valor_icms: valorIcms,
      aliquota_icms: it.aliqIcms,
      aliquota_ipi: it.aliqIpi,
      valor_ipi: it.ipi,
      gtin: 'SEM GTIN',
    }
  })

  const valorProdutos = itens.reduce((s, i) => s + i.valor_total, 0)
  const valorIcmsTotal = itens.reduce((s, i) => s + i.valor_icms, 0)
  const valorIpiTotal = itens.reduce((s, i) => s + i.valor_ipi, 0)
  const valorPis = +(valorProdutos * 0.0165).toFixed(2)
  const valorCofins = +(valorProdutos * 0.076).toFixed(2)
  const valorTotalNota = +(valorProdutos + valorIpiTotal).toFixed(2)

  const cscId = (empresa.csc_id_homol as string) || (empresa.csc_id as string) || 'FAKE000001'
  const qrUrl =
    modelo === 65
      ? `https://nfceh.sefaz.ce.gov.br/pages/consultaNFCe.jsf?p=${chave}|2|2|${cscId}|simulacao`
      : null

  // 5 parcelas mensais a partir de 30 dias (estilo do exemplo Luxottica).
  const fatura = Array.from({ length: 5 }, (_, i) => {
    const venc = new Date(dataEmissao)
    venc.setDate(venc.getDate() + 30 * (i + 1))
    return {
      numero: String(i + 1).padStart(3, '0'),
      vencimento: venc.toLocaleDateString('pt-BR'),
      valor: +(valorTotalNota / 5).toFixed(2),
    }
  })

  const transportadora = modelo === 55
    ? {
        razao_social: 'BRASPRESS TRANSPORTES URGENTES LTDA',
        cnpj: '48740351000165',
        ie: '116945108113',
        endereco: 'R CORONEL MARQUES RIBEIRO 225',
        municipio: 'SAO PAULO',
        uf: 'SP',
        antt: '',
        placa: '',
      }
    : null

  const volumes = modelo === 55
    ? {
        quantidade: 1,
        especie: 'VOLUME',
        marca: '',
        numeracao: '',
        peso_bruto: 0.74,
        peso_liquido: 0.74,
      }
    : null

  const nota: Record<string, unknown> = {
    numero,
    serie,
    modelo,
    ambiente_nfe: 2,
    status: 'autorizada',
    protocolo: '135' + String(dataEmissao.getTime()).slice(-12),
    chave_acesso: chave,
    natureza_operacao: 'VENDA DE MERCADORIA',
    tp_nf: 1, // 1=saída
    valor_produtos: valorProdutos,
    valor_desconto: 0,
    valor_frete: 0,
    valor_seguro: 0,
    valor_outras_despesas: 0,
    base_calculo_icms: valorProdutos,
    valor_icms: valorIcmsTotal,
    base_calculo_icms_st: 0,
    valor_icms_st: 0,
    valor_importacao: 0,
    valor_icms_remet: 0,
    valor_fcp_dest: 0,
    valor_pis: valorPis,
    valor_cofins: valorCofins,
    valor_ipi: valorIpiTotal,
    valor_icms_dest: 0,
    valor_total_tributos: 0,
    valor_total: valorTotalNota,
    valor_pago: valorTotalNota,
    troco: 0,
    forma_pagamento: modelo === 65 ? '17' : '03', // PIX ou cartão crédito
    qr_code_nfce: qrUrl,
    data_autorizacao: dataEmissao.toISOString(),
    modalidade_frete: modelo === 55 ? 0 : 9,
    fatura: modelo === 55 ? fatura : undefined,
    transportadora,
    volumes,
    info_complementar:
      'NOTA SIMULADA PARA TESTE LOCAL — sem valor fiscal. Documento emitido por ME ou EPP optante pelo Simples Nacional. Não gera direito a crédito fiscal de ICMS, ISS e IPI.',
  }

  await persistirNotaSimulada(empresa.id, nota, itens, modelo, cscId)

  const data: DanfeData = {
    empresa: empresa as Record<string, unknown>,
    cliente: cliente as Record<string, unknown> | undefined,
    nota,
    itens,
  }

  const html =
    modelo === 65 ? await renderDanfeNfceFromData(data) : await renderDanfeNfeFromData(data)

  const filename = `nota-teste-${modelo === 65 ? 'nfce' : 'nfe'}-${dataEmissao.getTime()}.html`
  const fullPath = `C:\\Users\\felip\\Desktop\\${filename}`
  await writeFile(fullPath, html, 'utf-8')

  console.log(`\n✓ DANFE gerada:        ${fullPath}`)
  console.log(`  Chave de acesso:     ${chave}`)
  console.log(`  Protocolo simulado:  ${nota.protocolo}`)
  console.log(`  Empresa:             ${empresa.razao_social}`)
  console.log(`  Total:               R$ ${valorProdutos.toFixed(2)}`)
  console.log(`\nAbrindo no browser…`)

  // Abre no browser padrão
  exec(`start "" "${fullPath}"`)
}

async function carregarEmpresa() {
  const { data: list } = await supabase.from('empresas').select('*').order('created_at')
  if (!list || list.length === 0) {
    throw new Error('Nenhuma empresa cadastrada — rode `npm run seed:teste` primeiro.')
  }
  // Prefere a "OTICA TESTE LTDA" do seed
  const teste = list.find((e) => String(e.razao_social || '').includes('TESTE'))
  return teste || list[0]
}

async function carregarProdutos(empresaId: string) {
  const { data } = await supabase
    .from('produtos')
    .select('*')
    .eq('empresa_id', empresaId)
    .eq('tipo', 'produto')
    .eq('ativo', true)
    .order('created_at')
  if (!data || data.length === 0) {
    throw new Error('Nenhum produto cadastrado pra empresa — rode `npm run seed:teste` primeiro.')
  }
  return data
}

async function carregarCliente(empresaId: string, modelo: 55 | 65) {
  // NFC-e <R$10k pode ser sem cliente; NF-e geralmente tem.
  if (modelo === 65) {
    return null
  }
  const { data } = await supabase
    .from('clientes')
    .select('*')
    .eq('empresa_id', empresaId)
    .limit(1)
    .maybeSingle()
  return data
}

async function garantirCscFake(empresaId: string) {
  const payload: Record<string, unknown> = {
    csc_id: 'FAKE000001',
    csc_token: 'FAKE-TOKEN-HOMOLOGACAO-TESTE-LOCAL-32B',
  }
  await supabase.from('empresas').update(payload).eq('id', empresaId)
}

/**
 * Tenta persistir a nota e os itens nas tabelas reais. Se as migrations 013/014
 * não estiverem aplicadas, alguns campos vão ser rejeitados — nesse caso, faz
 * fallback pra um insert mínimo (só pra aparecer na lista /nfe). Itens só
 * conseguem ser persistidos se a migration 013 estiver aplicada.
 */
async function persistirNotaSimulada(
  empresaId: string,
  nota: Record<string, unknown>,
  itens: Array<Record<string, unknown>>,
  modelo: 55 | 65,
  _cscId: string,
): Promise<void> {
  const insert = {
    empresa_id: empresaId,
    tipo: modelo === 65 ? 'nfce' : 'nfe',
    ...nota,
  }

  let notaId: string | null = null
  let r = await supabase.from('notas_fiscais').insert(insert).select('id').single()
  if (r.error) {
    // Tenta com payload mínimo (sem campos da migration 013)
    const minimo = {
      empresa_id: empresaId,
      tipo: insert.tipo,
      status: insert.status,
      chave_acesso: insert.chave_acesso,
      protocolo: insert.protocolo,
      serie: insert.serie,
      numero: insert.numero,
      valor_total: insert.valor_total,
    }
    r = await supabase.from('notas_fiscais').insert(minimo).select('id').single()
    if (r.error) {
      console.log(`  ⚠️  Não consegui persistir nota em notas_fiscais: ${r.error.message}`)
      console.log(`     → DANFE foi só renderizada em arquivo, não vai aparecer em /nfe.`)
      return
    }
    console.log(`  ⚠️  Migration 013 não aplicada — nota persistida só com colunas básicas.`)
  }
  notaId = r.data?.id || null
  if (!notaId) return

  const rowsItens = itens.map((it) => ({ ...it, nota_id: notaId }))
  const itensRes = await supabase.from('notas_fiscais_itens').insert(rowsItens)
  if (itensRes.error) {
    console.log(`  ⚠️  Itens não persistidos (provavelmente migration 013 não aplicada): ${itensRes.error.message}`)
  } else {
    console.log(`  ✓ Nota persistida em notas_fiscais (id=${notaId}) com ${itens.length} itens.`)
  }
}

main().catch((e) => {
  console.error('Falhou:', e.message || e)
  process.exit(1)
})
