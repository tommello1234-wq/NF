/**
 * Lê o XML autorizado (nfeProc) e devolve os campos da DANFE.
 *
 * Por que isso existe: a DANFE era montada só com colunas de
 * `notas_fiscais`/`notas_fiscais_itens`. Esse caminho funciona pra NFC-e de
 * venda, onde toda coluna é preenchida, mas quebra em silêncio quando a nota
 * usa campos que a tabela não tem — foi o caso da devolução de compra, que
 * saiu impressa como "VENDA DE MERCADORIA", com destinatário sem endereço e
 * ICMS/IPI zerados, mesmo tendo sido autorizada com todos esses valores.
 *
 * A DANFE é, por definição, a representação gráfica do XML: se as duas
 * discordam, quem vale é o XML — e uma DANFE que discorda é recusada. Então em
 * vez de espelhar cada campo novo numa coluna (e voltar a divergir no próximo
 * tipo de nota), a DANFE passa a ler do próprio documento autorizado.
 *
 * Só sobrescreve o que o XML realmente traz; o resto continua vindo do banco.
 */

import { XMLParser } from 'fast-xml-parser'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false, // chaves e CNPJs são strings: 0 à esquerda importa
  trimValues: true,
})

/** Sempre devolve array: fast-xml-parser colapsa lista de 1 item em objeto. */
function lista<T>(v: T | T[] | undefined): T[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

function n(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const x = Number(v)
  return Number.isFinite(x) ? x : undefined
}

/** Encontra o primeiro grupo presente dentro de <ICMS>/<IPI> (o XML traz só um). */
function primeiroGrupo(obj: unknown): Record<string, unknown> | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  const vals = Object.values(obj as Record<string, unknown>)
  const grupo = vals.find((v) => v && typeof v === 'object')
  return grupo as Record<string, unknown> | undefined
}

export interface DanfeXmlOverlay {
  nota: Record<string, unknown>
  /** Destinatário do XML, no formato que o template espera de `cliente`. */
  cliente?: Record<string, unknown>
  itens: Array<Record<string, unknown>>
}

/**
 * @param xml conteúdo do nfeProc (ou de uma NFe solta)
 * @returns campos prontos pra sobrepor em `DanfeData`, ou null se o XML não
 *          for uma NF-e/NFC-e legível — nesse caso a DANFE segue com o banco.
 */
export function overlayDoXmlAutorizado(xml: string): DanfeXmlOverlay | null {
  let raiz: Record<string, unknown>
  try {
    raiz = parser.parse(xml) as Record<string, unknown>
  } catch {
    return null
  }

  const proc = (raiz.nfeProc || raiz) as Record<string, unknown>
  const nfe = (proc.NFe || proc) as Record<string, unknown>
  const infNFe = nfe.infNFe as Record<string, unknown> | undefined
  if (!infNFe) return null

  const ide = (infNFe.ide || {}) as Record<string, unknown>
  const dest = infNFe.dest as Record<string, unknown> | undefined
  const total = ((infNFe.total as Record<string, unknown>)?.ICMSTot || {}) as Record<string, unknown>
  const transp = (infNFe.transp || {}) as Record<string, unknown>
  const infAdic = (infNFe.infAdic || {}) as Record<string, unknown>
  const protocolo = (proc.protNFe as Record<string, unknown>)?.infProt as
    | Record<string, unknown>
    | undefined

  // --- itens ---
  const itens = lista(infNFe.det as Record<string, unknown>[]).map((det, i) => {
    const prod = (det.prod || {}) as Record<string, unknown>
    const imposto = (det.imposto || {}) as Record<string, unknown>
    const icms = primeiroGrupo(imposto.ICMS)
    // <IPI> traz cEnq no primeiro nível e os valores dentro de IPITrib (ou
    // IPINT, quando não tributado — aí só existe o CST).
    const grupoIpi = (imposto.IPI || {}) as Record<string, unknown>
    const ipiTrib = (grupoIpi.IPITrib || grupoIpi.IPINT) as Record<string, unknown> | undefined

    return {
      numero_item: n(det['@_nItem']) ?? i + 1,
      codigo_produto: prod.cProd ?? '',
      descricao: prod.xProd ?? '',
      ncm: prod.NCM ?? '',
      cest: prod.CEST ?? undefined,
      cfop: prod.CFOP ?? '',
      unidade_comercial: prod.uCom ?? '',
      quantidade_comercial: n(prod.qCom) ?? 0,
      valor_unitario: n(prod.vUnCom) ?? 0,
      valor_total: n(prod.vProd) ?? 0,
      valor_desconto: n(prod.vDesc) ?? 0,
      gtin: prod.cEAN ?? '',
      fci: prod.nFCI ?? undefined,
      origem: n(icms?.orig),
      // CST (regime normal) e CSOSN (Simples) ocupam a mesma coluna da DANFE.
      cst_csosn: (icms?.CSOSN ?? icms?.CST ?? '') as string,
      base_calculo_icms: n(icms?.vBC) ?? 0,
      aliquota_icms: n(icms?.pICMS) ?? 0,
      valor_icms: n(icms?.vICMS) ?? 0,
      aliquota_ipi: n(ipiTrib?.pIPI) ?? 0,
      valor_ipi: n(ipiTrib?.vIPI) ?? 0,
      cst_ipi: ipiTrib?.CST as string | undefined,
    }
  })

  // --- nota ---
  const nota: Record<string, unknown> = {
    modelo: n(ide.mod),
    numero: ide.nNF,
    serie: n(ide.serie),
    natureza_operacao: ide.natOp,
    tp_nf: n(ide.tpNF),
    finalidade: n(ide.finNFe),
    ambiente_nfe: n(ide.tpAmb),
    consumidor_final: n(ide.indFinal),
    indicador_presenca: n(ide.indPres),
    chave_acesso: String(infNFe['@_Id'] || '').replace(/\D/g, '') || undefined,
    valor_produtos: n(total.vProd),
    valor_desconto: n(total.vDesc),
    valor_frete: n(total.vFrete),
    valor_seguro: n(total.vSeg),
    valor_outras_despesas: n(total.vOutro),
    base_calculo_icms: n(total.vBC),
    valor_icms: n(total.vICMS),
    valor_icms_st: n(total.vST),
    valor_ipi: n(total.vIPI),
    valor_pis: n(total.vPIS),
    valor_cofins: n(total.vCOFINS),
    valor_total: n(total.vNF),
    modalidade_frete: n(transp.modFrete),
    info_complementar: infAdic.infCpl,
    protocolo: protocolo?.nProt,
    data_autorizacao: protocolo?.dhRecbto || ide.dhEmi,
  }

  // Pagamento: a bobina da NFC-e imprime a forma e o troco.
  const pag = (infNFe.pag || {}) as Record<string, unknown>
  const detPag = lista(pag.detPag as Record<string, unknown>[])
  if (detPag.length > 0) {
    nota.forma_pagamento = detPag[0].tPag
    const somaPago = detPag.reduce((s, d) => s + (n(d.vPag) ?? 0), 0)
    nota.valor_pago = +somaPago.toFixed(2)
  }
  if (pag.vTroco != null) nota.troco = n(pag.vTroco)

  const vol = lista(transp.vol as Record<string, unknown>[])[0]
  if (vol) {
    nota.volumes = {
      quantidade: n(vol.qVol),
      especie: vol.esp,
      marca: vol.marca,
      numeracao: vol.nVol,
      peso_liquido: n(vol.pesoL),
      peso_bruto: n(vol.pesoB),
    }
  }

  const transportadora = transp.transporta as Record<string, unknown> | undefined
  if (transportadora) {
    nota.transportadora = {
      razao_social: transportadora.xNome,
      cnpj: transportadora.CNPJ || transportadora.CPF,
      ie: transportadora.IE,
      endereco: transportadora.xEnder,
      municipio: transportadora.xMun,
      uf: transportadora.UF,
    }
  }

  // --- destinatário ---
  // Vai no lugar de `cliente` porque é de lá que o template lê endereço, IE e
  // telefone. Numa devolução o destinatário é o fornecedor, que não tem (nem
  // deve ter) cadastro de cliente.
  let cliente: Record<string, unknown> | undefined
  if (dest) {
    const end = (dest.enderDest || {}) as Record<string, unknown>
    cliente = {
      nome: dest.xNome,
      cpf_cnpj: dest.CNPJ || dest.CPF || '',
      ie: dest.IE,
      telefone: end.fone,
      endereco_logradouro: end.xLgr,
      endereco_numero: end.nro,
      endereco_complemento: end.xCpl,
      endereco_bairro: end.xBairro,
      endereco_cidade: end.xMun,
      endereco_uf: end.UF,
      endereco_cep: end.CEP,
    }
    // A bobina da NFC-e identifica o consumidor por estes dois campos da nota,
    // não pelo cadastro — então eles também vêm do XML.
    nota.destinatario_nome = dest.xNome
    nota.destinatario_cpf_cnpj = dest.CNPJ || dest.CPF
  }

  // Campos ausentes no XML não devem apagar o que o banco tem: o overlay é
  // aplicado com spread, e uma chave com `undefined` sobrescreveria o valor
  // bom. Vale principalmente pro cupom, cujo <dest> só traz nome e CPF — sem
  // isso o endereço do cliente sumiria da NFC-e.
  limparIndefinidos(nota)
  if (cliente) limparIndefinidos(cliente)

  return { nota, cliente, itens }
}

function limparIndefinidos(obj: Record<string, unknown>): void {
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined || obj[k] === '') delete obj[k]
  }
}
