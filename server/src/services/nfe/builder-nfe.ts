/**
 * Builder XML de NF-e (modelo 55).
 *
 * Estrutura geral (PL_009_V4):
 *   <NFe xmlns versao="4.00">
 *     <infNFe Id="NFe{chave44}" versao="4.00">
 *       <ide>...</ide>            <!-- identificação -->
 *       <emit>...</emit>          <!-- emitente (a empresa) -->
 *       <dest>...</dest>          <!-- destinatário -->
 *       <det nItem="1">...</det>  <!-- 1 por produto -->
 *       <total>...</total>
 *       <transp>...</transp>
 *       <pag>...</pag>
 *       <infAdic>...</infAdic>    <!-- opcional -->
 *     </infNFe>
 *     <ds:Signature/>             <!-- preenchida pelo signer -->
 *   </NFe>
 *
 * ⚠️ ESQUELETO DE TESTE — implementação parcial; validações fortes do schema
 * XSD (PL_009_V4) ficam como TODO. A intenção aqui é montar a estrutura
 * inicial e expor as funções que o orquestrador vai usar.
 */

import { create } from 'xmlbuilder2'
import { NFE_NS, VERSAO_LAYOUT, type Ambiente, type Modelo, type Finalidade } from './types.js'

export interface BuildNfeInput {
  chaveAcesso: string                   // 44 chars
  cnf: string                           // 8 chars (parte da chave, vai em <cNF>)
  cdv: string                           // 1 char (vai em <cDV>)
  modelo: Modelo
  ambiente: Ambiente
  serie: number
  numero: number
  dataEmissao: Date
  dataSaida?: Date
  finalidade: Finalidade
  consumidorFinal: boolean
  indicadorPresenca: number
  naturezaOperacao: string
  emit: EmitenteXml
  dest?: DestinatarioXml
  itens: ItemXml[]
  total: TotalXml
  transp: TranspXml
  pag: PagamentoXml[]
  informacoesComplementares?: string
}

export interface EmitenteXml {
  cnpj: string
  nome: string
  fantasia?: string
  ie: string
  im?: string
  crt: 1 | 2 | 3 | 4
  endereco: EnderecoXml
  cnae?: string
}

export interface DestinatarioXml {
  cpf?: string
  cnpj?: string
  nome: string
  email?: string
  endereco?: EnderecoXml
  ie?: string
  indicadorIe: 1 | 2 | 9
}

export interface EnderecoXml {
  logradouro: string
  numero: string
  bairro: string
  codigoMunicipio: string  // 7 dígitos IBGE
  municipio: string
  uf: string
  cep: string              // 8 dígitos
  complemento?: string
  pais?: { codigo: string; nome: string }  // default 1058 / BRASIL
  fone?: string
}

export interface ItemXml {
  numero: number
  codigo: string
  descricao: string
  ncm: string
  cest?: string
  cfop: string
  unidadeComercial: string
  unidadeTributavel?: string
  quantidadeComercial: number
  quantidadeTributavel?: number
  valorUnitario: number
  valorUnitarioTributavel?: number
  valorTotal: number
  gtin: string             // 'SEM GTIN' se não tiver
  origem: number
  cstCsosn: string
  aliquotaIcms?: number
  valorIcms?: number
  cstPis: string
  aliquotaPis?: number
  valorPis?: number
  cstCofins: string
  aliquotaCofins?: number
  valorCofins?: number
  cstIpi?: string
  aliquotaIpi?: number
  valorIpi?: number
  exTipi?: string
  pesoLiquido?: number
  pesoBruto?: number
  infoAdicional?: string
  valorDesconto?: number
  /** ID interno (não vai pro XML) — útil pro orquestrador persistir o vínculo */
  produtoId?: string
}

export interface TotalXml {
  valorProdutos: number
  valorDesconto: number
  valorFrete: number
  valorSeguro: number
  valorOutras: number
  valorBaseIcms?: number
  valorIcms: number
  valorIcmsSt: number
  valorIpi: number
  valorPis: number
  valorCofins: number
  valorTotalNota: number
  valorTotalTributos?: number
}

export interface TranspXml {
  modalidadeFrete: number
  transportadora?: { cnpj?: string; nome?: string; ie?: string; endereco?: string; uf?: string }
  veiculo?: { placa: string; uf: string; rntc?: string }
  volumes?: Array<{ qVol?: number; esp?: string; marca?: string; nVol?: string; pesoL?: number; pesoB?: number }>
}

export interface PagamentoXml {
  forma: string                       // tPag (01, 03, 17, etc.)
  valor: number
  troco?: number
  cnpjCredenciadora?: string
  bandeira?: string
  autorizacao?: string
}

/**
 * Monta o XML não-assinado da NF-e/NFC-e.
 * O signer vai injetar a tag <Signature> dentro de <NFe> depois.
 */
export function buildNfeXml(input: BuildNfeInput): { xml: string; idNfe: string } {
  const idNfe = `NFe${input.chaveAcesso}`

  const infNFe: Record<string, unknown> = {
    '@Id': idNfe,
    '@versao': VERSAO_LAYOUT,
    ide: montarIde(input),
    emit: montarEmit(input.emit),
  }
  if (input.dest) infNFe.dest = montarDest(input.dest)
  infNFe.det = input.itens.map((item) => montarDet(item, input))
  infNFe.total = montarTotal(input.total)
  infNFe.transp = montarTransp(input.transp)
  infNFe.pag = montarPag(input.pag)
  if (input.informacoesComplementares) {
    infNFe.infAdic = { infCpl: input.informacoesComplementares }
  }

  const doc = create({ version: '1.0', encoding: 'UTF-8' }, {
    NFe: {
      '@xmlns': NFE_NS,
      infNFe,
    },
  })

  return { xml: doc.end({ prettyPrint: false, headless: false }), idNfe }
}

// === Helpers — devolvem objetos JSON que viram XML pelo xmlbuilder2 ===
// (Mantidos como esqueleto; campos opcionais ficam undefined e o builder pula)

function montarIde(input: BuildNfeInput) {
  return {
    cUF: '23',                                        // CE
    cNF: input.cnf,
    natOp: input.naturezaOperacao,
    mod: String(input.modelo),
    serie: String(input.serie),
    nNF: String(input.numero),
    dhEmi: toIsoUtc(input.dataEmissao),
    ...(input.modelo === 55 && input.dataSaida
      ? { dhSaiEnt: toIsoUtc(input.dataSaida) }
      : {}),
    tpNF: '1',                                        // 1=saída
    idDest: '1',                                      // 1=interna, 2=interestadual, 3=exterior  TODO calcular
    cMunFG: input.emit.endereco.codigoMunicipio,
    tpImp: input.modelo === 65 ? '4' : '1',           // 1=retrato, 4=DANFE NFC-e
    tpEmis: '1',                                      // 1=normal
    cDV: input.cdv,
    tpAmb: String(input.ambiente),
    finNFe: String(input.finalidade),
    indFinal: input.consumidorFinal ? '1' : '0',
    indPres: String(input.indicadorPresenca),
    procEmi: '0',                                     // 0=aplicativo do contribuinte
    verProc: 'NF-API-1.0',
  }
}

function montarEmit(e: EmitenteXml) {
  return {
    CNPJ: e.cnpj,
    xNome: e.nome,
    ...(e.fantasia ? { xFant: e.fantasia } : {}),
    enderEmit: {
      xLgr: e.endereco.logradouro,
      nro: e.endereco.numero,
      ...(e.endereco.complemento ? { xCpl: e.endereco.complemento } : {}),
      xBairro: e.endereco.bairro,
      cMun: e.endereco.codigoMunicipio,
      xMun: e.endereco.municipio,
      UF: e.endereco.uf,
      CEP: e.endereco.cep,
      cPais: e.endereco.pais?.codigo || '1058',
      xPais: e.endereco.pais?.nome || 'BRASIL',
      ...(e.endereco.fone ? { fone: e.endereco.fone } : {}),
    },
    IE: e.ie,
    ...(e.im ? { IM: e.im } : {}),
    ...(e.cnae ? { CNAE: e.cnae } : {}),
    CRT: String(e.crt),
  }
}

function montarDest(d: DestinatarioXml) {
  return {
    ...(d.cnpj ? { CNPJ: d.cnpj } : d.cpf ? { CPF: d.cpf } : {}),
    xNome: d.nome,
    ...(d.endereco
      ? {
          enderDest: {
            xLgr: d.endereco.logradouro,
            nro: d.endereco.numero,
            xBairro: d.endereco.bairro,
            cMun: d.endereco.codigoMunicipio,
            xMun: d.endereco.municipio,
            UF: d.endereco.uf,
            CEP: d.endereco.cep,
            cPais: '1058',
            xPais: 'BRASIL',
          },
        }
      : {}),
    indIEDest: String(d.indicadorIe),
    ...(d.ie ? { IE: d.ie } : {}),
    ...(d.email ? { email: d.email } : {}),
  }
}

function montarDet(item: ItemXml, ctx: BuildNfeInput) {
  const ufEmit = ctx.emit.endereco.uf
  const ufDest = ctx.dest?.endereco?.uf
  const interestadual = !!ufDest && ufDest !== ufEmit
  const uTrib = item.unidadeTributavel || item.unidadeComercial
  const qTrib = (item.quantidadeTributavel ?? item.quantidadeComercial).toFixed(4)
  const vUnTrib = (item.valorUnitarioTributavel ?? item.valorUnitario).toFixed(4)

  return {
    '@nItem': String(item.numero),
    prod: {
      cProd: item.codigo,
      cEAN: item.gtin || 'SEM GTIN',
      xProd: item.descricao,
      NCM: item.ncm,
      ...(item.exTipi ? { EXTIPI: item.exTipi } : {}),
      ...(item.cest ? { CEST: item.cest } : {}),
      CFOP: item.cfop,
      uCom: item.unidadeComercial,
      qCom: item.quantidadeComercial.toFixed(4),
      vUnCom: item.valorUnitario.toFixed(4),
      vProd: item.valorTotal.toFixed(2),
      cEANTrib: item.gtin || 'SEM GTIN',
      uTrib,
      qTrib,
      vUnTrib,
      ...(item.valorDesconto ? { vDesc: item.valorDesconto.toFixed(2) } : {}),
      indTot: '1',
    },
    imposto: montarImposto(item, interestadual, ctx.emit.crt),
    ...(item.infoAdicional ? { infAdProd: item.infoAdicional } : {}),
  }
}

/**
 * Monta os impostos do item conforme o CRT da empresa e o CST/CSOSN do produto.
 * Hoje cobre o caso comum de ótica em Simples Nacional (CSOSN 102/103/300/400/500),
 * IPI quando o produto tem alíquota, PIS/COFINS NT (49) por padrão, e o grupo
 * ICMSUFDest pra venda interestadual a consumidor final.
 */
function montarImposto(item: ItemXml, interestadual: boolean, crt: 1 | 2 | 3 | 4 = 1) {
  const orig = String(item.origem)
  const code = item.cstCsosn

  // Para Simples Nacional (CRT 1 ou 4): grupo ICMSSN<CSOSN>
  // Para Regime Normal (CRT 3) ou Simples Sublimite (CRT 2): grupo ICMS<CST>
  const isSimples = crt === 1 || crt === 4
  const icms: Record<string, unknown> = {}

  if (isSimples) {
    // Simples Nacional — usa CSOSN
    if (code === '500' || code === '900') {
      icms[`ICMSSN${code}`] = { orig, CSOSN: code }
    } else if (code === '101' || code === '201') {
      icms[`ICMSSN${code}`] = {
        orig,
        CSOSN: code,
        ...(item.aliquotaIcms != null
          ? {
              pCredSN: item.aliquotaIcms.toFixed(2),
              vCredICMSSN: ((item.valorTotal * item.aliquotaIcms) / 100).toFixed(2),
            }
          : {}),
      }
    } else {
      icms[`ICMSSN${code}`] = { orig, CSOSN: code }
    }
  } else {
    // Regime Normal — usa CST (00, 10, 20, 30, 40, 41, 50, 51, 60, 70, 90)
    if (code === '00') {
      icms.ICMS00 = {
        orig,
        CST: '00',
        modBC: '3',
        vBC: item.valorTotal.toFixed(2),
        pICMS: (item.aliquotaIcms || 0).toFixed(2),
        vICMS: ((item.valorTotal * (item.aliquotaIcms || 0)) / 100).toFixed(2),
      }
    } else if (code === '40' || code === '41' || code === '50') {
      icms[`ICMS${code}`] = { orig, CST: code }
    } else if (code === '60') {
      icms.ICMS60 = {
        orig,
        CST: '60',
        vBCSTRet: '0.00',
        pST: '0.00',
        vICMSSubstituto: '0.00',
        vICMSSTRet: '0.00',
      }
    } else {
      // Fallback: usa CST 00 sem destaque
      icms.ICMS00 = {
        orig,
        CST: '00',
        modBC: '3',
        vBC: '0.00',
        pICMS: '0.00',
        vICMS: '0.00',
      }
    }
  }

  const imposto: Record<string, unknown> = {
    ICMS: icms,
    PIS: { [grupoPis(item.cstPis)]: pisPayload(item) },
    COFINS: { [grupoCofins(item.cstCofins)]: cofinsPayload(item) },
  }

  if (item.cstIpi && item.aliquotaIpi != null) {
    const vIpi = (item.valorTotal * item.aliquotaIpi) / 100
    imposto.IPI = {
      ...(item.exTipi ? { cEnq: item.exTipi } : { cEnq: '999' }),
      IPITrib: {
        CST: item.cstIpi,
        vBC: item.valorTotal.toFixed(2),
        pIPI: item.aliquotaIpi.toFixed(2),
        vIPI: vIpi.toFixed(2),
      },
    }
  }

  if (interestadual && item.aliquotaIcms != null) {
    imposto.ICMSUFDest = {
      vBCUFDest: item.valorTotal.toFixed(2),
      pFCPUFDest: '0.00',
      pICMSUFDest: item.aliquotaIcms.toFixed(2),
      pICMSInter: item.aliquotaIcms.toFixed(2),
      pICMSInterPart: '100.00',
      vFCPUFDest: '0.00',
      vICMSUFDest: ((item.valorTotal * item.aliquotaIcms) / 100).toFixed(2),
      vICMSUFRemet: '0.00',
    }
  }

  return imposto
}

function montarTotal(t: TotalXml) {
  return {
    ICMSTot: {
      vBC: (t.valorBaseIcms ?? 0).toFixed(2),
      vICMS: t.valorIcms.toFixed(2),
      vICMSDeson: '0.00',
      vFCP: '0.00',
      vBCST: '0.00',
      vST: t.valorIcmsSt.toFixed(2),
      vFCPST: '0.00',
      vFCPSTRet: '0.00',
      vProd: t.valorProdutos.toFixed(2),
      vFrete: t.valorFrete.toFixed(2),
      vSeg: t.valorSeguro.toFixed(2),
      vDesc: t.valorDesconto.toFixed(2),
      vII: '0.00',
      vIPI: t.valorIpi.toFixed(2),
      vIPIDevol: '0.00',
      vPIS: t.valorPis.toFixed(2),
      vCOFINS: t.valorCofins.toFixed(2),
      vOutro: t.valorOutras.toFixed(2),
      vNF: t.valorTotalNota.toFixed(2),
      ...(t.valorTotalTributos != null
        ? { vTotTrib: t.valorTotalTributos.toFixed(2) }
        : {}),
    },
  }
}

// Mapeia o CST do PIS pra grupo XML correto:
//   01-02 → PISAliq  (tributada na alíquota)
//   03    → PISQtde  (por quantidade)
//   04, 06-09 → PISNT   (não tributada)
//   05    → PISST    (substituição tributária)
//   49-99 → PISOutr  (outras operações)
function grupoPis(cst: string): string {
  if (['01', '02'].includes(cst)) return 'PISAliq'
  if (cst === '03') return 'PISQtde'
  if (['04', '06', '07', '08', '09'].includes(cst)) return 'PISNT'
  if (cst === '05') return 'PISST'
  return 'PISOutr'
}

function grupoCofins(cst: string): string {
  if (['01', '02'].includes(cst)) return 'COFINSAliq'
  if (cst === '03') return 'COFINSQtde'
  if (['04', '06', '07', '08', '09'].includes(cst)) return 'COFINSNT'
  if (cst === '05') return 'COFINSST'
  return 'COFINSOutr'
}

function pisPayload(item: ItemXml): Record<string, unknown> {
  const grupo = grupoPis(item.cstPis)
  if (grupo === 'PISNT') return { CST: item.cstPis }
  if (grupo === 'PISAliq') {
    return {
      CST: item.cstPis,
      vBC: item.valorTotal.toFixed(2),
      pPIS: (item.aliquotaPis || 0).toFixed(2),
      vPIS: ((item.valorTotal * (item.aliquotaPis || 0)) / 100).toFixed(2),
    }
  }
  // PISOutr e demais — pra Simples Nacional (CST 49/99) vai zerado
  return {
    CST: item.cstPis,
    vBC: '0.00',
    pPIS: '0.00',
    vPIS: '0.00',
  }
}

function cofinsPayload(item: ItemXml): Record<string, unknown> {
  const grupo = grupoCofins(item.cstCofins)
  if (grupo === 'COFINSNT') return { CST: item.cstCofins }
  if (grupo === 'COFINSAliq') {
    return {
      CST: item.cstCofins,
      vBC: item.valorTotal.toFixed(2),
      pCOFINS: (item.aliquotaCofins || 0).toFixed(2),
      vCOFINS: ((item.valorTotal * (item.aliquotaCofins || 0)) / 100).toFixed(2),
    }
  }
  return {
    CST: item.cstCofins,
    vBC: '0.00',
    pCOFINS: '0.00',
    vCOFINS: '0.00',
  }
}

function montarTransp(t: TranspXml) {
  const out: Record<string, unknown> = { modFrete: String(t.modalidadeFrete) }
  if (t.transportadora && (t.transportadora.cnpj || t.transportadora.nome)) {
    out.transporta = {
      ...(t.transportadora.cnpj ? { CNPJ: t.transportadora.cnpj } : {}),
      ...(t.transportadora.nome ? { xNome: t.transportadora.nome } : {}),
      ...(t.transportadora.ie ? { IE: t.transportadora.ie } : {}),
      ...(t.transportadora.endereco ? { xEnder: t.transportadora.endereco } : {}),
      ...(t.transportadora.uf ? { UF: t.transportadora.uf } : {}),
    }
  }
  if (t.veiculo) {
    out.veicTransp = {
      placa: t.veiculo.placa,
      UF: t.veiculo.uf,
      ...(t.veiculo.rntc ? { RNTC: t.veiculo.rntc } : {}),
    }
  }
  if (t.volumes && t.volumes.length > 0) {
    out.vol = t.volumes.map((v) => ({
      ...(v.qVol != null ? { qVol: String(v.qVol) } : {}),
      ...(v.esp ? { esp: v.esp } : {}),
      ...(v.marca ? { marca: v.marca } : {}),
      ...(v.nVol ? { nVol: v.nVol } : {}),
      ...(v.pesoL != null ? { pesoL: v.pesoL.toFixed(3) } : {}),
      ...(v.pesoB != null ? { pesoB: v.pesoB.toFixed(3) } : {}),
    }))
  }
  return out
}

function montarPag(pagamentos: PagamentoXml[]) {
  return {
    detPag: pagamentos.map((p) => ({
      indPag: '0',
      tPag: p.forma,
      vPag: p.valor.toFixed(2),
      ...(p.cnpjCredenciadora || p.bandeira || p.autorizacao
        ? {
            card: {
              tpIntegra: '2',
              ...(p.cnpjCredenciadora ? { CNPJ: p.cnpjCredenciadora } : {}),
              ...(p.bandeira ? { tBand: p.bandeira } : {}),
              ...(p.autorizacao ? { cAut: p.autorizacao } : {}),
            },
          }
        : {}),
    })),
    ...(pagamentos[0]?.troco != null
      ? { vTroco: pagamentos[0].troco.toFixed(2) }
      : {}),
  }
}

function toIsoUtc(d: Date): string {
  // ISO 8601 com timezone offset -03:00 (Brasília, sem DST atual).
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}-03:00`
  )
}
