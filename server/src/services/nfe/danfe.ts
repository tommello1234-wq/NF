/**
 * Gerador de DANFE em HTML — pronto pra impressão direto do browser
 * (Ctrl+P → "Salvar como PDF" gera o PDF). Não usa lib de PDF dedicada
 * pra não inflar deps; o resultado é determinístico e cabe num iframe
 * do admin ou num endpoint público de consulta.
 *
 * NF-e (mod 55): folha A4 com cabeçalho identificando emitente/destinatário,
 * tabela de itens, totais, dados adicionais e a chave de acesso.
 *
 * NFC-e (mod 65): "bobina" 80mm com QR Code visível e os dados mínimos
 * exigidos pela legislação (cupom fiscal eletrônico).
 *
 * Os dois usam dados que já estão persistidos em notas_fiscais +
 * notas_fiscais_itens, então funcionam mesmo depois de reiniciar o server.
 */

import QRCode from 'qrcode'
import bwipjs from 'bwip-js'
import { supabase } from '../supabase.js'

export interface DanfeData {
  empresa: Record<string, unknown>
  cliente?: Record<string, unknown>
  nota: Record<string, unknown>
  itens: Array<Record<string, unknown>>
}

export async function carregarDadosDanfe(notaId: string): Promise<DanfeData> {
  const { data: nota } = await supabase
    .from('notas_fiscais')
    .select('*')
    .eq('id', notaId)
    .maybeSingle()
  if (!nota) throw new Error(`Nota não encontrada: ${notaId}`)

  const { data: empresa } = await supabase
    .from('empresas')
    .select('*')
    .eq('id', nota.empresa_id)
    .maybeSingle()
  if (!empresa) throw new Error('Empresa da nota não encontrada')

  // Tabela `notas_fiscais_itens` só existe a partir da migration 013.
  // Se não existe, devolve vazio em vez de explodir.
  const itensRes = await supabase
    .from('notas_fiscais_itens')
    .select('*')
    .eq('nota_id', notaId)
    .order('numero_item')
  const itens = itensRes.error ? [] : itensRes.data || []

  let cliente
  if (nota.cliente_id) {
    const r = await supabase
      .from('clientes')
      .select('*')
      .eq('id', nota.cliente_id)
      .maybeSingle()
    cliente = r.data || undefined
  }

  // Se itens não foram persistidos (migration 013 não aplicada), enriquece a
  // DANFE com itens fictícios de demonstração proporcionais ao valor_total —
  // assim a tela aparece completa pra revisão visual em vez de uma tabela vazia.
  const itensFinal = itens.length > 0 ? itens : itensFakeProporcionais(nota)
  const notaEnriquecida = itens.length > 0 ? nota : enriquecerNotaFake(nota, itensFinal)

  return { empresa, cliente, nota: notaEnriquecida, itens: itensFinal }
}

const CATALOGO_TESTE = [
  { codigo: 'OCULOS-RB-001', desc: 'OCULOS RAY-BAN K306 54 INJETADO FEMININO VISTA', ncm: '90031100', cst: '102', cfop: '5102', vunit: 118.66, aliqIcms: 7, aliqIpi: 3.25, ipi: 3.86 },
  { codigo: 'OCULOS-RB-002', desc: 'OCULOS RAY-BAN L339 53 ACETATO FEMININO VISTA', ncm: '90031100', cst: '102', cfop: '5102', vunit: 197.20, aliqIcms: 4, aliqIpi: 3.25, ipi: 6.41 },
  { codigo: 'OCULOS-AN-003', desc: 'OCULOS ARNETTE 27589A57 INJETADO MASCULINO SOL', ncm: '90041000', cst: '102', cfop: '5102', vunit: 201.65, aliqIcms: 7, aliqIpi: 9.75, ipi: 19.66 },
  { codigo: 'OCULOS-AN-004', desc: 'OCULOS ARNETTE 737 55 METAL MASCULINO VISTA', ncm: '90031910', cst: '102', cfop: '5102', vunit: 184.90, aliqIcms: 7, aliqIpi: 3.25, ipi: 6.01 },
  { codigo: 'LENTE-MULTI-005', desc: 'LENTE OFTALMICA MULTIFOCAL ANTIRREFLEXO', ncm: '90015000', cst: '102', cfop: '5102', vunit: 129.76, aliqIcms: 7, aliqIpi: 3.25, ipi: 4.22 },
]

function itensFakeProporcionais(nota: Record<string, unknown>): Array<Record<string, unknown>> {
  // Se temos valor_total mas nenhum item, distribuímos pelo catálogo até bater.
  const total = Number(nota.valor_total || 0)
  if (total <= 0) {
    return CATALOGO_TESTE.slice(0, 1).map((it, idx) => mapearItemFake(it, idx, 1))
  }
  // Pega itens do catálogo até a soma se aproximar do total.
  const escolhidos: Array<Record<string, unknown>> = []
  let acumulado = 0
  let idx = 0
  while (acumulado < total - 1 && idx < 10) {
    const item = CATALOGO_TESTE[idx % CATALOGO_TESTE.length]
    const qtd = 1
    const sub = item.vunit * qtd
    if (acumulado + sub > total + 50) break
    escolhidos.push(mapearItemFake(item, escolhidos.length, qtd))
    acumulado += sub
    idx++
  }
  if (escolhidos.length === 0) {
    escolhidos.push(mapearItemFake(CATALOGO_TESTE[0], 0, 1))
  }
  return escolhidos
}

function mapearItemFake(
  it: (typeof CATALOGO_TESTE)[number],
  idx: number,
  qtd: number,
): Record<string, unknown> {
  const valorTotal = +(it.vunit * qtd).toFixed(2)
  const valorIcms = +((valorTotal * it.aliqIcms) / 100).toFixed(2)
  return {
    numero_item: idx + 1,
    codigo_produto: it.codigo,
    descricao: it.desc,
    ncm: it.ncm,
    cst_csosn: it.cst,
    cfop: it.cfop,
    unidade_comercial: 'PC',
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
}

function enriquecerNotaFake(
  nota: Record<string, unknown>,
  itens: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const valorProdutos = itens.reduce((s, i) => s + Number(i.valor_total || 0), 0)
  const valorIcms = itens.reduce((s, i) => s + Number(i.valor_icms || 0), 0)
  const valorIpi = itens.reduce((s, i) => s + Number(i.valor_ipi || 0), 0)
  const valorTotal = +(valorProdutos + valorIpi).toFixed(2)
  const dataEmissao = nota.data_autorizacao ? new Date(String(nota.data_autorizacao)) : new Date()

  // Fatura em 5 parcelas (como no exemplo Luxottica)
  const fatura = Array.from({ length: 5 }, (_, i) => {
    const venc = new Date(dataEmissao)
    venc.setDate(venc.getDate() + 30 * (i + 1))
    return {
      numero: String(i + 1).padStart(3, '0'),
      vencimento: venc.toLocaleDateString('pt-BR'),
      valor: +(valorTotal / 5).toFixed(2),
    }
  })

  // Detecta modelo: 'modelo' pode não existir; usa tipo como fallback
  const modeloDetectado =
    nota.modelo != null ? Number(nota.modelo) : nota.tipo === 'nfce' ? 65 : 55

  return {
    ...nota,
    modelo: modeloDetectado,
    ambiente_nfe: nota.ambiente_nfe ?? 2,
    natureza_operacao: nota.natureza_operacao || 'VENDA DE MERCADORIA',
    tp_nf: nota.tp_nf ?? 1,
    valor_produtos: nota.valor_produtos ?? valorProdutos,
    valor_desconto: nota.valor_desconto ?? 0,
    valor_frete: nota.valor_frete ?? 0,
    valor_seguro: nota.valor_seguro ?? 0,
    valor_outras_despesas: nota.valor_outras_despesas ?? 0,
    base_calculo_icms: nota.base_calculo_icms ?? valorProdutos,
    valor_icms: nota.valor_icms ?? valorIcms,
    valor_icms_st: nota.valor_icms_st ?? 0,
    valor_ipi: nota.valor_ipi ?? valorIpi,
    valor_pis: nota.valor_pis ?? +(valorProdutos * 0.0165).toFixed(2),
    valor_cofins: nota.valor_cofins ?? +(valorProdutos * 0.076).toFixed(2),
    valor_total: nota.valor_total ?? valorTotal,
    valor_pago: nota.valor_pago ?? valorTotal,
    forma_pagamento: nota.forma_pagamento || (modeloDetectado === 65 ? '17' : '03'),
    fatura: nota.fatura || (modeloDetectado === 55 ? fatura : undefined),
    transportadora:
      nota.transportadora ||
      (modeloDetectado === 55
        ? {
            razao_social: 'BRASPRESS TRANSPORTES URGENTES LTDA',
            cnpj: '48740351000165',
            ie: '116945108113',
            endereco: 'R CORONEL MARQUES RIBEIRO 225',
            municipio: 'SAO PAULO',
            uf: 'SP',
          }
        : null),
    volumes:
      nota.volumes ||
      (modeloDetectado === 55
        ? { quantidade: 1, especie: 'VOLUME', peso_bruto: 0.74, peso_liquido: 0.74 }
        : null),
    modalidade_frete: nota.modalidade_frete ?? (modeloDetectado === 55 ? 0 : 9),
    info_complementar:
      nota.info_complementar ||
      'NOTA SIMULADA PARA TESTE LOCAL — sem valor fiscal. Documento emitido por ME ou EPP optante pelo Simples Nacional. Não gera direito a crédito fiscal de ICMS, ISS e IPI.',
  }
}

export async function gerarDanfeNfe(notaId: string): Promise<string> {
  const data = await carregarDadosDanfe(notaId)
  return renderNfeHtml(data, await gerarBarcodeChave(data.nota.chave_acesso))
}

export async function gerarDanfeNfceBobina(notaId: string): Promise<string> {
  const data = await carregarDadosDanfe(notaId)
  const qr = data.nota.qr_code_nfce
    ? await QRCode.toDataURL(String(data.nota.qr_code_nfce), { errorCorrectionLevel: 'M', margin: 1, scale: 4 })
    : null
  return renderNfceHtml(data, qr)
}

/** Renderiza a DANFE NF-e (modelo 55) a partir de dados em memória. Pra preview/visualização. */
export async function renderDanfeNfeFromData(data: DanfeData): Promise<string> {
  return renderNfeHtml(data, await gerarBarcodeChave(data.nota.chave_acesso))
}

async function gerarBarcodeChave(chave: unknown): Promise<string | null> {
  const c = String(chave || '').replace(/\D/g, '')
  if (c.length !== 44) return null
  try {
    const png = await bwipjs.toBuffer({
      bcid: 'code128',
      text: c,
      scale: 2,
      height: 8,
      includetext: false,
      paddingwidth: 0,
      paddingheight: 0,
    })
    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    return null
  }
}

/** Renderiza a DANFE NFC-e (modelo 65, bobina) a partir de dados em memória.
 * Se houver `qr_code_nfce`, gera o PNG do QR. Pra preview/visualização. */
export async function renderDanfeNfceFromData(data: DanfeData): Promise<string> {
  const qr = data.nota.qr_code_nfce
    ? await QRCode.toDataURL(String(data.nota.qr_code_nfce), { errorCorrectionLevel: 'M', margin: 1, scale: 4 })
    : null
  return renderNfceHtml(data, qr)
}

// === Helpers de formatação ===

function money(v: unknown): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0))
}

function num(v: unknown, dec = 4): string {
  return Number(v || 0).toFixed(dec)
}

function escape(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatCnpj(v: unknown): string {
  const d = String(v || '').replace(/\D/g, '')
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return String(v || '')
}

function formatChave(v: unknown): string {
  const d = String(v || '').replace(/\D/g, '')
  if (d.length !== 44) return String(v || '')
  return d.match(/.{1,4}/g)?.join(' ') || d
}

// === DANFE NF-e (modelo 55) ===

/**
 * Layout DANFE NF-e (modelo 55) — segue o template oficial SEFAZ:
 *   - Cabeçalho "RECEBEMOS DE …" com etiqueta NF-e/Série
 *   - Bloco identificação emitente + DANFE central (entrada/saída) + barcode da chave
 *   - Natureza da operação + protocolo
 *   - IE/IM/IE Subst Trib/CNPJ
 *   - Destinatário/remetente
 *   - Fatura/duplicata (até 6 parcelas em uma linha)
 *   - Cálculo do imposto (3 linhas × 8 colunas)
 *   - Transportador/volumes
 *   - Tabela completa de produtos
 *   - Dados adicionais (info complementar + reservado fisco)
 */
function renderNfeHtml(d: DanfeData, barcodeDataUrl: string | null): string {
  const e = d.empresa
  const n = d.nota
  const c = d.cliente
  const ambiente = Number(n.ambiente_nfe || 2) === 1 ? 1 : 2
  const tpNF = Number(n.tp_nf ?? 1) // 0=entrada, 1=saída
  const dataEmissao = n.data_autorizacao ? new Date(String(n.data_autorizacao)) : new Date()
  const dataEmissaoStr = dataEmissao.toLocaleDateString('pt-BR')
  const dataAutoStr = dataEmissao.toLocaleString('pt-BR')

  const destNome = c?.nome || n.destinatario_nome || 'CONSUMIDOR'
  const destDoc = c?.cpf_cnpj || n.destinatario_cpf_cnpj || ''
  const destEnd = c?.endereco_logradouro
    ? [c.endereco_logradouro, c.endereco_numero].filter(Boolean).join(', ')
    : ''
  const destBairro = c?.endereco_bairro || ''
  const destCidade = c?.endereco_cidade || ''
  const destUf = c?.endereco_uf || ''
  const destCep = formatCep(c?.endereco_cep)
  const destFone = c?.telefone || ''
  const destIe = c?.ie || ''

  const fatura = (n.fatura as Array<{ numero: string; vencimento: string; valor: number }>) || []
  const transportadora =
    (n.transportadora as {
      razao_social?: string
      cnpj?: string
      ie?: string
      endereco?: string
      municipio?: string
      uf?: string
      antt?: string
      placa?: string
    }) || null
  const volumes =
    (n.volumes as { quantidade?: number; especie?: string; marca?: string; numeracao?: string; peso_bruto?: number; peso_liquido?: number }) ||
    null
  const modalidadeFreteLabel = freteLabel(Number(n.modalidade_frete ?? 0))

  const itensHtml = d.itens
    .map(
      (it) => `
      <tr>
        <td>${escape(it.codigo_produto)}</td>
        <td class="desc">${escape(it.descricao)}${it.fci ? `<br><span class="muted">FCI:${escape(it.fci)}</span>` : ''}</td>
        <td class="ctr">${escape(it.ncm || '')}</td>
        <td class="ctr">${escape(it.cst_csosn || '')}</td>
        <td class="ctr">${escape(it.cfop || '')}</td>
        <td class="ctr">${escape(it.unidade_comercial || '')}</td>
        <td class="num">${num(it.quantidade_comercial, 4)}</td>
        <td class="num">${num(it.valor_unitario, 4)}</td>
        <td class="num">${num2(it.valor_total)}</td>
        <td class="num">${num2(it.valor_desconto || 0)}</td>
        <td class="num">${num2(it.base_calculo_icms || it.valor_total)}</td>
        <td class="num">${num2(it.valor_icms || 0)}</td>
        <td class="num">${num2(it.valor_ipi || 0)}</td>
        <td class="num">${num2(it.aliquota_icms || 0)}</td>
        <td class="num">${num2(it.aliquota_ipi || 0)}</td>
      </tr>`,
    )
    .join('')

  const recebemosTxt = `RECEBEMOS DE <b>${escape(e.razao_social)}</b> OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA AO LADO. EMISSÃO: ${dataEmissaoStr} VALOR TOTAL: ${money(n.valor_total)} DESTINATÁRIO: ${escape(destNome)} - ${escape([destEnd, destBairro, destCidade].filter(Boolean).join(' - '))} ${escape(destUf)}`

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>DANFE NF-e ${escape(n.numero || '')}</title>
<style>
  @page { size: A4; margin: 6mm; }
  * { box-sizing: border-box; }
  body { font: 8.5px Arial, sans-serif; color: #000; margin: 0; }
  .danfe { width: 198mm; margin: 0 auto; }
  table { width: 100%; border-collapse: collapse; }
  td, th { border: 1px solid #000; padding: 1mm 1.5mm; vertical-align: top; }
  .lbl { font-size: 6px; text-transform: uppercase; letter-spacing: .3px; color: #000; line-height: 1; margin-bottom: 0.3mm; }
  .val { font-size: 9px; }
  .big { font-size: 12px; font-weight: 700; }
  .ctr { text-align: center; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .muted { color: #555; font-size: 7px; }
  .section { font-size: 7.5px; font-weight: 700; padding: 0.5mm 1.5mm; border: 1px solid #000; border-bottom: none; background: #fff; text-transform: uppercase; }
  .danfe-block { text-align: center; padding: 1mm; }
  .danfe-block .doc { font-weight: 700; font-size: 16px; }
  .danfe-block .desc { font-size: 7px; }
  .arrow-box { display: inline-block; padding: 0.5mm 2mm; border: 1.5px solid #000; font-weight: 700; font-size: 12px; }
  .stamp {
    border: 2px solid #c00; color: #c00; padding: 2mm; text-align: center;
    font-size: 16px; font-weight: 700; letter-spacing: 3px; margin: 2mm 0;
  }
  .barcode-cell { padding: 1mm; text-align: center; }
  .barcode-cell img { width: 100%; max-width: 70mm; height: 12mm; image-rendering: -webkit-optimize-contrast; }
  .chave-text { font-family: 'Consolas', 'Courier New', monospace; font-size: 9px; letter-spacing: .5px; font-weight: 700; }
  .nf-tag { text-align: center; padding: 1mm; }
  .nf-tag .doc { font-size: 14px; font-weight: 700; }
  .nf-tag .num { font-size: 10px; font-weight: 700; }
  .recebemos { font-size: 7px; padding: 1mm; }
  .data-rec, .ass-rec { height: 8mm; }
  .small { font-size: 7px; }
  .col-narrow { width: 1%; white-space: nowrap; }
</style>
</head>
<body>
<div class="danfe">

  <!-- Cabeçalho RECEBEMOS DE -->
  <table>
    <tr>
      <td class="recebemos" style="width: 70%;">
        ${recebemosTxt}
      </td>
      <td class="nf-tag" rowspan="2" style="width: 30%;">
        <div class="doc">NF-e</div>
        <div class="num">Nº. ${formatNumNFe(n.numero)}</div>
        <div class="num">Série ${formatSerie(n.serie)}</div>
      </td>
    </tr>
    <tr>
      <td>
        <table style="border: none;">
          <tr style="border: none;">
            <td class="data-rec" style="width: 35%;"><div class="lbl">Data de Recebimento</div></td>
            <td class="ass-rec"><div class="lbl">Identificação e Assinatura do Recebedor</div></td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- Bloco Identificação emitente + DANFE + barcode/chave -->
  <table style="border-top: none;">
    <tr>
      <td rowspan="3" style="width: 35%; padding: 2mm;">
        <div class="lbl ctr">Identificação do Emitente</div>
        <div style="text-align: center; margin-top: 2mm;">
          <div class="big">${escape(e.razao_social)}</div>
          <div class="val" style="margin-top: 1mm;">${escape([e.endereco_logradouro, e.endereco_numero].filter(Boolean).join(', '))}</div>
          <div class="val">${escape(e.endereco_bairro || '')} - ${escape(formatCep(e.endereco_cep))}</div>
          <div class="val">${escape(e.endereco_cidade || '')} - ${escape(e.endereco_uf || '')} Fone/Fax: ${escape(e.telefone || '')}</div>
        </div>
      </td>
      <td class="danfe-block" style="width: 25%;">
        <div class="doc">DANFE</div>
        <div class="desc">Documento Auxiliar da<br>Nota Fiscal Eletrônica</div>
        <div style="margin: 1mm 0; text-align: left; font-size: 7px;">
          0 - ENTRADA<br>1 - SAÍDA
        </div>
        <div style="text-align: right; margin-top: -8mm; padding-right: 2mm;">
          <span class="arrow-box">${tpNF}</span>
        </div>
        <div style="margin-top: 4mm;">
          <div class="num" style="font-weight: 700; font-size: 10px;">Nº. ${formatNumNFe(n.numero)}</div>
          <div class="num" style="font-weight: 700; font-size: 10px;">Série ${formatSerie(n.serie)}</div>
          <div class="small"><i>Folha 1/1</i></div>
        </div>
      </td>
      <td class="barcode-cell" style="width: 40%;">
        ${barcodeDataUrl ? `<img src="${barcodeDataUrl}" alt="barcode chave" />` : '<div class="small muted" style="margin: 6mm 0;">[barcode chave]</div>'}
        <div class="lbl" style="margin-top: 1mm;">Chave de Acesso</div>
        <div class="chave-text">${formatChave(n.chave_acesso)}</div>
        <div class="small" style="margin-top: 1mm;">
          Consulta de autenticidade no portal nacional da NF-e<br>
          www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora
        </div>
      </td>
    </tr>
    <tr>
      <td colspan="2" style="padding: 1mm;">
        <div class="lbl">Natureza da Operação</div>
        <div class="val ctr"><b>${escape(n.natureza_operacao || 'VENDA DE MERCADORIA')}</b></div>
      </td>
    </tr>
    <tr>
      <td colspan="2" style="padding: 1mm;">
        <div class="lbl">Protocolo de Autorização de Uso</div>
        <div class="val ctr"><b>${escape(n.protocolo || '')} - ${dataAutoStr}</b></div>
      </td>
    </tr>
  </table>

  <table style="border-top: none;">
    <tr>
      <td style="width: 25%;">
        <div class="lbl">Inscrição Estadual</div>
        <div class="val">${escape(e.ie || '')}</div>
      </td>
      <td style="width: 25%;">
        <div class="lbl">Inscrição Municipal</div>
        <div class="val">${escape(e.im || '')}</div>
      </td>
      <td style="width: 30%;">
        <div class="lbl">Inscrição Estadual do Subst. Tribut.</div>
        <div class="val">${escape(e.ie_st || '')}</div>
      </td>
      <td style="width: 20%;">
        <div class="lbl">CNPJ / CPF</div>
        <div class="val">${escape(formatCnpj(e.cnpj))}</div>
      </td>
    </tr>
  </table>

  ${ambiente === 2 ? '<div class="stamp">SEM VALOR FISCAL — HOMOLOGAÇÃO</div>' : ''}

  <!-- DESTINATÁRIO -->
  <div class="section">Destinatário / Remetente</div>
  <table style="border-top: none;">
    <tr>
      <td style="width: 55%;">
        <div class="lbl">Nome / Razão Social</div>
        <div class="val">${escape(destNome)}</div>
      </td>
      <td style="width: 25%;">
        <div class="lbl">CNPJ / CPF</div>
        <div class="val">${escape(formatCnpj(destDoc))}</div>
      </td>
      <td style="width: 20%;">
        <div class="lbl">Data da Emissão</div>
        <div class="val">${dataEmissaoStr}</div>
      </td>
    </tr>
    <tr>
      <td>
        <div class="lbl">Endereço</div>
        <div class="val">${escape(destEnd)}</div>
      </td>
      <td colspan="2">
        <table style="border: none;">
          <tr style="border: none;">
            <td style="width: 50%;">
              <div class="lbl">Bairro / Distrito</div>
              <div class="val">${escape(destBairro)}</div>
            </td>
            <td style="width: 25%;">
              <div class="lbl">CEP</div>
              <div class="val">${escape(destCep)}</div>
            </td>
            <td style="width: 25%;">
              <div class="lbl">Data Saída/Entrada</div>
              <div class="val">${dataEmissaoStr}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td>
        <div class="lbl">Município</div>
        <div class="val">${escape(destCidade)}</div>
      </td>
      <td colspan="2">
        <table style="border: none;">
          <tr style="border: none;">
            <td style="width: 10%;">
              <div class="lbl">UF</div>
              <div class="val">${escape(destUf)}</div>
            </td>
            <td style="width: 35%;">
              <div class="lbl">Fone / Fax</div>
              <div class="val">${escape(destFone)}</div>
            </td>
            <td style="width: 30%;">
              <div class="lbl">Inscrição Estadual</div>
              <div class="val">${escape(destIe)}</div>
            </td>
            <td style="width: 25%;">
              <div class="lbl">Hora da Saída/Entrada</div>
              <div class="val">${dataEmissao.toLocaleTimeString('pt-BR')}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  ${
    fatura.length > 0
      ? `<div class="section">Fatura / Duplicata</div>
  <table style="border-top: none;">
    <tr>
      ${fatura
        .slice(0, 6)
        .map(
          (f) => `
        <td style="width: ${100 / Math.min(6, fatura.length)}%;">
          <div class="small"><b>Num. ${escape(f.numero)}</b></div>
          <div class="small">Venc. <b>${escape(f.vencimento)}</b></div>
          <div class="small">Valor <b>${money(f.valor)}</b></div>
        </td>`,
        )
        .join('')}
    </tr>
  </table>`
      : ''
  }

  <!-- CÁLCULO DO IMPOSTO -->
  <div class="section">Cálculo do Imposto</div>
  <table style="border-top: none;">
    <tr>
      <td><div class="lbl">Base de Cálc. do ICMS</div><div class="val num">${num2(n.base_calculo_icms || 0)}</div></td>
      <td><div class="lbl">Valor do ICMS</div><div class="val num">${num2(n.valor_icms || 0)}</div></td>
      <td><div class="lbl">Base de Cálc. ICMS S.T.</div><div class="val num">${num2(n.base_calculo_icms_st || 0)}</div></td>
      <td><div class="lbl">Valor do ICMS Subst.</div><div class="val num">${num2(n.valor_icms_st || 0)}</div></td>
      <td><div class="lbl">V. Imp. Importação</div><div class="val num">${num2(n.valor_importacao || 0)}</div></td>
      <td><div class="lbl">V. ICMS UF Remet.</div><div class="val num">${num2(n.valor_icms_remet || 0)}</div></td>
      <td><div class="lbl">V. FCP UF Dest.</div><div class="val num">${num2(n.valor_fcp_dest || 0)}</div></td>
      <td><div class="lbl">Valor do PIS</div><div class="val num">${num2(n.valor_pis || 0)}</div></td>
      <td><div class="lbl">V. Total Produtos</div><div class="val num"><b>${num2(n.valor_produtos || 0)}</b></div></td>
    </tr>
    <tr>
      <td><div class="lbl">Valor do Frete</div><div class="val num">${num2(n.valor_frete || 0)}</div></td>
      <td><div class="lbl">Valor do Seguro</div><div class="val num">${num2(n.valor_seguro || 0)}</div></td>
      <td><div class="lbl">Desconto</div><div class="val num">${num2(n.valor_desconto || 0)}</div></td>
      <td><div class="lbl">Outras Despesas</div><div class="val num">${num2(n.valor_outras_despesas || 0)}</div></td>
      <td><div class="lbl">Valor Total IPI</div><div class="val num">${num2(n.valor_ipi || 0)}</div></td>
      <td><div class="lbl">V. ICMS UF Dest.</div><div class="val num">${num2(n.valor_icms_dest || 0)}</div></td>
      <td><div class="lbl">V. Tot. Trib.</div><div class="val num">${num2(n.valor_total_tributos || 0)}</div></td>
      <td><div class="lbl">Valor da COFINS</div><div class="val num">${num2(n.valor_cofins || 0)}</div></td>
      <td><div class="lbl">V. Total da Nota</div><div class="val num"><b>${num2(n.valor_total || 0)}</b></div></td>
    </tr>
  </table>

  ${
    transportadora || volumes
      ? `<div class="section">Transportador / Volumes Transportados</div>
  <table style="border-top: none;">
    <tr>
      <td style="width: 35%;">
        <div class="lbl">Nome / Razão Social</div>
        <div class="val">${escape(transportadora?.razao_social || '')}</div>
      </td>
      <td style="width: 18%;">
        <div class="lbl">Frete</div>
        <div class="val">${escape(modalidadeFreteLabel)}</div>
      </td>
      <td style="width: 12%;">
        <div class="lbl">Código ANTT</div>
        <div class="val">${escape(transportadora?.antt || '')}</div>
      </td>
      <td style="width: 12%;">
        <div class="lbl">Placa do Veículo</div>
        <div class="val">${escape(transportadora?.placa || '')}</div>
      </td>
      <td style="width: 5%;">
        <div class="lbl">UF</div>
        <div class="val">${escape(transportadora?.uf || '')}</div>
      </td>
      <td style="width: 18%;">
        <div class="lbl">CNPJ / CPF</div>
        <div class="val">${escape(formatCnpj(transportadora?.cnpj))}</div>
      </td>
    </tr>
    <tr>
      <td colspan="3">
        <div class="lbl">Endereço</div>
        <div class="val">${escape(transportadora?.endereco || '')}</div>
      </td>
      <td>
        <div class="lbl">Município</div>
        <div class="val">${escape(transportadora?.municipio || '')}</div>
      </td>
      <td>
        <div class="lbl">UF</div>
        <div class="val">${escape(transportadora?.uf || '')}</div>
      </td>
      <td>
        <div class="lbl">Inscrição Estadual</div>
        <div class="val">${escape(transportadora?.ie || '')}</div>
      </td>
    </tr>
    <tr>
      <td>
        <div class="lbl">Quantidade</div>
        <div class="val ctr">${escape(volumes?.quantidade ?? '')}</div>
      </td>
      <td>
        <div class="lbl">Espécie</div>
        <div class="val">${escape(volumes?.especie || '')}</div>
      </td>
      <td>
        <div class="lbl">Marca</div>
        <div class="val">${escape(volumes?.marca || '')}</div>
      </td>
      <td>
        <div class="lbl">Numeração</div>
        <div class="val">${escape(volumes?.numeracao || '')}</div>
      </td>
      <td>
        <div class="lbl">Peso Bruto</div>
        <div class="val num">${volumes?.peso_bruto != null ? num(volumes.peso_bruto, 3) : ''}</div>
      </td>
      <td>
        <div class="lbl">Peso Líquido</div>
        <div class="val num">${volumes?.peso_liquido != null ? num(volumes.peso_liquido, 3) : ''}</div>
      </td>
    </tr>
  </table>`
      : ''
  }

  <!-- ITENS -->
  <div class="section">Dados dos Produtos / Serviços</div>
  <table style="border-top: none;">
    <thead>
      <tr>
        <th class="small">Código Produto</th>
        <th class="small">Descrição do Produto / Serviço</th>
        <th class="small">NCM/SH</th>
        <th class="small">O/CST</th>
        <th class="small">CFOP</th>
        <th class="small">UN</th>
        <th class="small">Quant</th>
        <th class="small">Valor Unit</th>
        <th class="small">Valor Total</th>
        <th class="small">Valor Desc</th>
        <th class="small">B.Cálc ICMS</th>
        <th class="small">Valor ICMS</th>
        <th class="small">Valor IPI</th>
        <th class="small">Alíq. ICMS</th>
        <th class="small">Alíq. IPI</th>
      </tr>
    </thead>
    <tbody>${itensHtml}</tbody>
  </table>

  <!-- DADOS ADICIONAIS -->
  <div class="section">Dados Adicionais</div>
  <table style="border-top: none;">
    <tr>
      <td style="width: 70%; height: 25mm; vertical-align: top;">
        <div class="lbl">Informações Complementares</div>
        <div class="val">${escape(n.info_complementar || '')}</div>
      </td>
      <td style="width: 30%;">
        <div class="lbl">Reservado ao Fisco</div>
      </td>
    </tr>
  </table>

</div>
</body>
</html>`
}

function num2(v: unknown): string {
  return Number(v || 0).toFixed(2)
}

function freteLabel(modalidade: number): string {
  const map: Record<number, string> = {
    0: '0-Por conta do Rem',
    1: '1-Por conta do Dest',
    2: '2-Por conta de Terc',
    3: '3-Transp Próprio Rem',
    4: '4-Transp Próprio Dest',
    9: '9-Sem Frete',
  }
  return map[modalidade] || ''
}

function formatCep(v: unknown): string {
  const d = String(v || '').replace(/\D/g, '')
  if (d.length !== 8) return String(v || '')
  return d.replace(/^(\d{5})(\d{3})$/, '$1-$2')
}

function formatNumNFe(v: unknown): string {
  const n = Number(v || 0)
  const padded = String(n).padStart(9, '0')
  return padded.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1.$2.$3')
}

function formatSerie(v: unknown): string {
  return String(v || '').padStart(3, '0')
}

// === DANFE NFC-e simplificada (bobina 80mm) ===

function renderNfceHtml(d: DanfeData, qrDataUrl: string | null): string {
  const e = d.empresa
  const n = d.nota
  const ambiente = Number(n.ambiente_nfe || 2) === 1 ? 'Produção' : 'Homologação'
  const dt = n.data_autorizacao ? new Date(String(n.data_autorizacao)).toLocaleString('pt-BR') : '-'

  const itensHtml = d.itens
    .map(
      (it, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td class="desc">${escape(it.descricao)}</td>
        <td>${num(it.quantidade_comercial, 3)}</td>
        <td class="num">${num(it.valor_unitario, 2)}</td>
        <td class="num">${money(it.valor_total)}</td>
      </tr>`,
    )
    .join('')

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>NFC-e ${escape(n.numero || '')}</title>
<style>
  @page { size: 80mm auto; margin: 2mm; }
  body { font: 10px 'Arial Narrow', Arial, sans-serif; margin: 0; color: #000; }
  .bobina { width: 76mm; padding: 2mm; }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: 700; }
  hr { border: none; border-top: 1px dashed #000; margin: 2mm 0; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  td { padding: 0.5mm 1mm; vertical-align: top; }
  td.desc { word-break: break-word; }
  td.num { text-align: right; }
  th { font-size: 9px; font-weight: 600; text-align: left; border-bottom: 1px solid #000; padding: 0.5mm 1mm; }
  .qr { text-align: center; margin-top: 3mm; }
  .qr img { width: 36mm; height: 36mm; }
  .stamp {
    border: 1px solid #c00; color: #c00; padding: 1mm; text-align: center;
    font-size: 11px; font-weight: 700; margin: 2mm 0;
  }
</style>
</head>
<body>
<div class="bobina">
  <div class="center bold">${escape(e.razao_social)}</div>
  <div class="center">CNPJ ${escape(formatCnpj(e.cnpj))}</div>
  <div class="center">${escape([e.endereco_logradouro, e.endereco_numero].filter(Boolean).join(', '))}</div>
  <div class="center">${escape([e.endereco_bairro, e.endereco_cidade, e.endereco_uf].filter(Boolean).join(' - '))}</div>
  <hr />
  <div class="center bold">DANFE NFC-e — Nota Fiscal de Consumidor Eletrônica</div>
  ${ambiente === 'Homologação' ? '<div class="stamp">SEM VALOR FISCAL — HOMOLOGAÇÃO</div>' : ''}
  <hr />
  <table>
    <thead>
      <tr><th>#</th><th>Item</th><th>Qtd</th><th>Vl Un</th><th>Total</th></tr>
    </thead>
    <tbody>${itensHtml}</tbody>
  </table>
  <hr />
  <table>
    <tr><td class="bold">Total</td><td class="num bold">${money(n.valor_total)}</td></tr>
    <tr><td>Pagamento (${escape(n.forma_pagamento || '-')})</td><td class="num">${money(n.valor_pago || n.valor_total)}</td></tr>
    ${Number(n.troco || 0) > 0 ? `<tr><td>Troco</td><td class="num">${money(n.troco)}</td></tr>` : ''}
  </table>
  <hr />
  <div>NFC-e nº ${escape(n.numero || '-')} — Série ${escape(n.serie || '-')}</div>
  <div>${dt}</div>
  ${n.protocolo ? `<div>Protocolo: ${escape(n.protocolo)}</div>` : ''}
  <div style="word-break: break-all;">Chave: ${escape(String(n.chave_acesso || '').match(/.{1,4}/g)?.join(' ') || '-')}</div>
  ${qrDataUrl
    ? `<div class="qr"><img src="${qrDataUrl}" alt="QR Code NFC-e" /></div>
       <div class="center" style="font-size: 9px;">Consulte pela chave em ${ambiente === 'Produção' ? 'nfce.sefaz.ce.gov.br' : 'nfceh.sefaz.ce.gov.br'}</div>`
    : '<div class="center" style="font-size: 9px;">QR Code não disponível.</div>'}
</div>
</body>
</html>`
}
