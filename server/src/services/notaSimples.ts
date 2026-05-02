type EmpresaNfe = {
  cnpj: string
  ie?: string | null
  crt?: number | null
  regime_tributario?: string | null
  ambiente_sefaz?: number | null
  razao_social: string
  nome: string
  endereco_logradouro?: string | null
  endereco_numero?: string | null
  endereco_bairro?: string | null
  endereco_cidade?: string | null
  endereco_uf?: string | null
  endereco_cep?: string | null
  endereco_codigo_ibge?: string | null
  telefone?: string | null
}

type ClienteNfe = {
  nome?: string | null
  cpf_cnpj?: string | null
  ie?: string | null
  endereco_logradouro?: string | null
  endereco_numero?: string | null
  endereco_bairro?: string | null
  endereco_cidade?: string | null
  endereco_uf?: string | null
  endereco_cep?: string | null
  endereco_codigo_ibge?: string | null
  telefone?: string | null
}

type ProdutoNfe = {
  descricao?: string | null
  codigo_interno?: string | null
  ncm?: string | null
  cfop?: string | null
  unidade?: string | null
  valor_unitario?: number | string | null
  origem?: number | null
  cst_csosn?: string | null
  aliquota_icms?: number | string | null
  aliquota_pis?: number | string | null
  aliquota_cofins?: number | string | null
}

type NotaSimpleInput = {
  empresa: EmpresaNfe
  cliente?: ClienteNfe | null
  produto?: ProdutoNfe | null
  nota: {
    tipo: 'nfe' | 'nfce'
    numero: number
    serie: number
    destinatario_nome: string
    destinatario_cpf_cnpj: string
    descricao: string
    quantidade?: number
    valor_unitario?: number
    valor_total: number
  }
  chaveAcesso: string
  protocolo: string
}

function digits(value: unknown) {
  return String(value || '').replace(/\D/g, '')
}

function dec(value: unknown, places = 2) {
  return Number(value || 0).toFixed(places)
}

function mod11(body: string) {
  let weight = 2
  let sum = 0
  for (let i = body.length - 1; i >= 0; i -= 1) {
    sum += Number.parseInt(body[i], 10) * weight
    weight = weight === 9 ? 2 : weight + 1
  }
  const rest = sum % 11
  return rest < 2 ? 0 : 11 - rest
}

export function gerarChaveAcesso(input: {
  ufCodigo?: string | null
  cnpj: string
  modelo?: '55' | '65'
  serie: number
  numero: number
}) {
  const now = new Date()
  const uf = digits(input.ufCodigo || '23').padStart(2, '0').slice(0, 2)
  const aamm = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`
  const cnpj = digits(input.cnpj).padStart(14, '0').slice(0, 14)
  const modelo = input.modelo || '55'
  const serie = String(input.serie || 1).padStart(3, '0').slice(-3)
  const numero = String(input.numero || 1).padStart(9, '0').slice(-9)
  const codigo = String(Math.floor(10000000 + Math.random() * 89999999))
  const body = `${uf}${aamm}${cnpj}${modelo}${serie}${numero}1${codigo}`
  return `${body}${mod11(body)}`
}

function xmlEscape(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function xmlTag(name: string, value: unknown) {
  return `<${name}>${xmlEscape(value)}</${name}>`
}

function onlyAscii(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
}

function nfeText(value: unknown, fallback = '') {
  const cleaned = String(value ?? fallback).trim()
  return cleaned || fallback
}

function formatDhEmi(date = new Date()) {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

function cufFromEmpresa(empresa: EmpresaNfe) {
  return digits(empresa.endereco_codigo_ibge || '23').padStart(2, '0').slice(0, 2)
}

function normalizarCrt(empresa: EmpresaNfe) {
  if (empresa.crt && empresa.crt >= 1 && empresa.crt <= 4) return empresa.crt
  if (empresa.regime_tributario === 'mei') return 4
  if (empresa.regime_tributario === 'lucro_presumido' || empresa.regime_tributario === 'lucro_real') return 3
  return 1
}

function enderecoEmitenteXml(empresa: EmpresaNfe) {
  return `<enderEmit>
      ${xmlTag('xLgr', nfeText(empresa.endereco_logradouro, 'NAO INFORMADO'))}
      ${xmlTag('nro', nfeText(empresa.endereco_numero, 'SN'))}
      ${xmlTag('xBairro', nfeText(empresa.endereco_bairro, 'NAO INFORMADO'))}
      ${xmlTag('cMun', digits(empresa.endereco_codigo_ibge).padStart(7, '0').slice(0, 7))}
      ${xmlTag('xMun', nfeText(empresa.endereco_cidade, 'NAO INFORMADO'))}
      ${xmlTag('UF', nfeText(empresa.endereco_uf, 'CE').toUpperCase().slice(0, 2))}
      ${xmlTag('CEP', digits(empresa.endereco_cep).padStart(8, '0').slice(0, 8))}
      ${xmlTag('cPais', '1058')}
      ${xmlTag('xPais', 'BRASIL')}
      ${digits(empresa.telefone) ? xmlTag('fone', digits(empresa.telefone).slice(0, 14)) : ''}
    </enderEmit>`
}

function enderecoDestinatarioXml(cliente: ClienteNfe | null | undefined) {
  if (!cliente?.endereco_logradouro && !cliente?.endereco_cidade) return ''
  return `<enderDest>
      ${xmlTag('xLgr', nfeText(cliente.endereco_logradouro, 'NAO INFORMADO'))}
      ${xmlTag('nro', nfeText(cliente.endereco_numero, 'SN'))}
      ${xmlTag('xBairro', nfeText(cliente.endereco_bairro, 'NAO INFORMADO'))}
      ${xmlTag('cMun', digits(cliente.endereco_codigo_ibge).padStart(7, '0').slice(0, 7))}
      ${xmlTag('xMun', nfeText(cliente.endereco_cidade, 'NAO INFORMADO'))}
      ${xmlTag('UF', nfeText(cliente.endereco_uf, 'CE').toUpperCase().slice(0, 2))}
      ${xmlTag('CEP', digits(cliente.endereco_cep).padStart(8, '0').slice(0, 8))}
      ${xmlTag('cPais', '1058')}
      ${xmlTag('xPais', 'BRASIL')}
      ${digits(cliente.telefone) ? xmlTag('fone', digits(cliente.telefone).slice(0, 14)) : ''}
    </enderDest>`
}

function validarPreNfe(input: NotaSimpleInput) {
  const avisos: string[] = []
  const { empresa, cliente, produto } = input
  if (digits(empresa.cnpj).length !== 14) avisos.push('CNPJ do emitente incompleto.')
  if (!empresa.ie) avisos.push('Inscricao Estadual do emitente nao informada.')
  if (!empresa.endereco_codigo_ibge) avisos.push('Codigo IBGE do municipio do emitente nao informado.')
  if (!empresa.endereco_logradouro || !empresa.endereco_cidade || !empresa.endereco_uf || !empresa.endereco_cep) {
    avisos.push('Endereco fiscal do emitente incompleto.')
  }
  if (digits(input.nota.destinatario_cpf_cnpj).length < 11) avisos.push('CPF/CNPJ do destinatario incompleto.')
  if (!cliente?.endereco_codigo_ibge) avisos.push('Codigo IBGE/endereco do destinatario nao informado; XML fica apenas para conferencia.')
  if (!produto?.ncm || digits(produto.ncm).length !== 8) avisos.push('NCM do produto ausente ou incompleto.')
  if (!produto?.cfop || digits(produto.cfop).length !== 4) avisos.push('CFOP do produto ausente ou incompleto.')
  if (!produto?.cst_csosn) avisos.push('CST/CSOSN do produto ausente; usando padrao conservador.')
  return avisos
}

function impostoXml(empresa: EmpresaNfe, produto: ProdutoNfe | null | undefined, valorTotal: number) {
  const crt = normalizarCrt(empresa)
  const origem = Number(produto?.origem ?? 0)
  const cstCsosn = String(produto?.cst_csosn || '').replace(/\D/g, '')
  const aliquotaIcms = Number(produto?.aliquota_icms || 0)
  const aliquotaPis = Number(produto?.aliquota_pis || 0)
  const aliquotaCofins = Number(produto?.aliquota_cofins || 0)
  const baseIcms = crt === 3 && aliquotaIcms > 0 ? valorTotal : 0
  const valorIcms = baseIcms * aliquotaIcms / 100
  const valorPis = aliquotaPis > 0 ? valorTotal * aliquotaPis / 100 : 0
  const valorCofins = aliquotaCofins > 0 ? valorTotal * aliquotaCofins / 100 : 0

  const icms = crt === 3
    ? `<ICMS00>
          ${xmlTag('orig', origem)}
          ${xmlTag('CST', cstCsosn.length === 2 ? cstCsosn : '00')}
          ${xmlTag('modBC', '3')}
          ${xmlTag('vBC', dec(baseIcms))}
          ${xmlTag('pICMS', dec(aliquotaIcms))}
          ${xmlTag('vICMS', dec(valorIcms))}
        </ICMS00>`
    : `<ICMSSN102>
          ${xmlTag('orig', origem)}
          ${xmlTag('CSOSN', cstCsosn.length === 3 ? cstCsosn : '102')}
        </ICMSSN102>`

  const pis = aliquotaPis > 0
    ? `<PISAliq>
          ${xmlTag('CST', '01')}
          ${xmlTag('vBC', dec(valorTotal))}
          ${xmlTag('pPIS', dec(aliquotaPis))}
          ${xmlTag('vPIS', dec(valorPis))}
        </PISAliq>`
    : `<PISNT>${xmlTag('CST', '08')}</PISNT>`

  const cofins = aliquotaCofins > 0
    ? `<COFINSAliq>
          ${xmlTag('CST', '01')}
          ${xmlTag('vBC', dec(valorTotal))}
          ${xmlTag('pCOFINS', dec(aliquotaCofins))}
          ${xmlTag('vCOFINS', dec(valorCofins))}
        </COFINSAliq>`
    : `<COFINSNT>${xmlTag('CST', '08')}</COFINSNT>`

  return {
    baseIcms,
    valorIcms,
    valorPis,
    valorCofins,
    xml: `<imposto>
        ${xmlTag('vTotTrib', dec(0))}
        <ICMS>${icms}</ICMS>
        <PIS>${pis}</PIS>
        <COFINS>${cofins}</COFINS>
      </imposto>`,
  }
}

export function gerarXmlSimples(input: NotaSimpleInput) {
  const { empresa, cliente, produto, nota, chaveAcesso } = input
  const modelo = nota.tipo === 'nfce' ? '65' : '55'
  const cUF = cufFromEmpresa(empresa)
  const cNF = chaveAcesso.slice(35, 43)
  const cDV = chaveAcesso.slice(-1)
  const cMunFG = digits(empresa.endereco_codigo_ibge).padStart(7, '0').slice(0, 7)
  const destDoc = digits(nota.destinatario_cpf_cnpj)
  const quantidade = Number(nota.quantidade || 1)
  const valorUnitario = Number(nota.valor_unitario || nota.valor_total)
  const valorProduto = Number(nota.valor_total || quantidade * valorUnitario)
  const imposto = impostoXml(empresa, produto, valorProduto)
  const avisos = validarPreNfe(input)
  const ncm = digits(produto?.ncm).padStart(8, '0').slice(0, 8)
  const cfop = digits(produto?.cfop || '5102').padStart(4, '0').slice(0, 4)
  const unidade = nfeText(produto?.unidade, 'UN').toUpperCase().slice(0, 6)
  const codigoProduto = nfeText(produto?.codigo_interno, 'ITEM-1').slice(0, 60)
  const indIEDest = cliente?.ie ? '1' : '9'

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- PRE-NF-e gerada para conferencia. Sem assinatura digital e sem autorizacao SEFAZ. -->
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe versao="4.00" Id="NFe${xmlEscape(chaveAcesso)}">
    <ide>
      ${xmlTag('cUF', cUF)}
      ${xmlTag('cNF', cNF)}
      ${xmlTag('natOp', 'VENDA DE MERCADORIA')}
      ${xmlTag('mod', modelo)}
      ${xmlTag('serie', nota.serie)}
      ${xmlTag('nNF', nota.numero)}
      ${xmlTag('dhEmi', formatDhEmi())}
      ${xmlTag('dhSaiEnt', formatDhEmi())}
      ${xmlTag('tpNF', '1')}
      ${xmlTag('idDest', empresa.endereco_uf && cliente?.endereco_uf && empresa.endereco_uf !== cliente.endereco_uf ? '2' : '1')}
      ${xmlTag('cMunFG', cMunFG)}
      ${xmlTag('tpImp', modelo === '65' ? '4' : '1')}
      ${xmlTag('tpEmis', '1')}
      ${xmlTag('cDV', cDV)}
      ${xmlTag('tpAmb', Number(empresa.ambiente_sefaz || 2))}
      ${xmlTag('finNFe', '1')}
      ${xmlTag('indFinal', '1')}
      ${xmlTag('indPres', '9')}
      ${xmlTag('procEmi', '0')}
      ${xmlTag('verProc', 'notas-washi-0.2')}
    </ide>
    <emit>
      ${xmlTag('CNPJ', digits(empresa.cnpj))}
      ${xmlTag('xNome', nfeText(empresa.razao_social))}
      ${xmlTag('xFant', nfeText(empresa.nome, empresa.razao_social))}
      ${enderecoEmitenteXml(empresa)}
      ${xmlTag('IE', digits(empresa.ie))}
      ${xmlTag('CRT', normalizarCrt(empresa))}
    </emit>
    <dest>
      ${destDoc.length === 14 ? xmlTag('CNPJ', destDoc) : xmlTag('CPF', destDoc.padStart(11, '0').slice(0, 11))}
      ${xmlTag('xNome', nfeText(nota.destinatario_nome, cliente?.nome || 'CONSUMIDOR FINAL'))}
      ${enderecoDestinatarioXml(cliente)}
      ${xmlTag('indIEDest', indIEDest)}
      ${cliente?.ie ? xmlTag('IE', digits(cliente.ie)) : ''}
    </dest>
    <det nItem="1">
      <prod>
        ${xmlTag('cProd', codigoProduto)}
        ${xmlTag('cEAN', 'SEM GTIN')}
        ${xmlTag('xProd', nfeText(nota.descricao, produto?.descricao || 'PRODUTO'))}
        ${xmlTag('NCM', ncm)}
        ${xmlTag('CFOP', cfop)}
        ${xmlTag('uCom', unidade)}
        ${xmlTag('qCom', dec(quantidade, 4))}
        ${xmlTag('vUnCom', dec(valorUnitario, 10))}
        ${xmlTag('vProd', dec(valorProduto))}
        ${xmlTag('cEANTrib', 'SEM GTIN')}
        ${xmlTag('uTrib', unidade)}
        ${xmlTag('qTrib', dec(quantidade, 4))}
        ${xmlTag('vUnTrib', dec(valorUnitario, 10))}
        ${xmlTag('indTot', '1')}
      </prod>
      ${imposto.xml}
    </det>
    <total>
      <ICMSTot>
        ${xmlTag('vBC', dec(imposto.baseIcms))}
        ${xmlTag('vICMS', dec(imposto.valorIcms))}
        ${xmlTag('vICMSDeson', dec(0))}
        ${xmlTag('vFCP', dec(0))}
        ${xmlTag('vBCST', dec(0))}
        ${xmlTag('vST', dec(0))}
        ${xmlTag('vFCPST', dec(0))}
        ${xmlTag('vFCPSTRet', dec(0))}
        ${xmlTag('vProd', dec(valorProduto))}
        ${xmlTag('vFrete', dec(0))}
        ${xmlTag('vSeg', dec(0))}
        ${xmlTag('vDesc', dec(0))}
        ${xmlTag('vII', dec(0))}
        ${xmlTag('vIPI', dec(0))}
        ${xmlTag('vIPIDevol', dec(0))}
        ${xmlTag('vPIS', dec(imposto.valorPis))}
        ${xmlTag('vCOFINS', dec(imposto.valorCofins))}
        ${xmlTag('vOutro', dec(0))}
        ${xmlTag('vNF', dec(valorProduto))}
        ${xmlTag('vTotTrib', dec(0))}
      </ICMSTot>
    </total>
    <transp>${xmlTag('modFrete', '9')}</transp>
    <pag>
      <detPag>
        ${xmlTag('indPag', '0')}
        ${xmlTag('tPag', '99')}
        ${xmlTag('vPag', dec(valorProduto))}
      </detPag>
    </pag>
    <infAdic>
      ${xmlTag('infCpl', `PRE-NF-e para conferencia. ${avisos.join(' ')}`)}
    </infAdic>
  </infNFe>
</NFe>
`
}

function pdfEscape(value: unknown) {
  return onlyAscii(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function pdfText(x: number, y: number, size: number, value: unknown, options?: { bold?: boolean }) {
  const font = options?.bold ? 'F2' : 'F1'
  return `BT /${font} ${size} Tf ${x} ${y} Td (${pdfEscape(value)}) Tj ET`
}

function pdfRect(x: number, y: number, w: number, h: number) {
  return `${x} ${y} ${w} ${h} re S`
}

function money(value: unknown) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))
}

function short(value: unknown, max: number) {
  const text = onlyAscii(value).trim()
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text
}

function field(x: number, y: number, w: number, h: number, label: string, value: unknown, size = 8) {
  const lines = onlyAscii(value)
    .split(/\r?\n/)
    .map((line) => short(line, Math.floor(w / (size * 0.45))))
    .slice(0, Math.max(1, Math.floor((h - 12) / (size + 2))))

  return [
    pdfRect(x, y, w, h),
    pdfText(x + 4, y + h - 9, 6, label, { bold: true }),
    ...lines.map((line, index) => pdfText(x + 4, y + h - 20 - (index * (size + 2)), size, line)),
  ].join('\n')
}

function formatDoc(value: unknown) {
  const doc = digits(value)
  if (doc.length === 14) return doc.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (doc.length === 11) return doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return doc
}

export function gerarDanfeSimples(input: NotaSimpleInput) {
  const { empresa, cliente, produto, nota, chaveAcesso, protocolo } = input
  const quantidade = Number(nota.quantidade || 1)
  const valorUnitario = Number(nota.valor_unitario || nota.valor_total)
  const valorProduto = Number(nota.valor_total || quantidade * valorUnitario)
  const imposto = impostoXml(empresa, produto, valorProduto)
  const avisos = validarPreNfe(input)
  const content: string[] = []
  const x = 28
  const width = 539

  content.push('0.7 w')
  content.push(field(x, 746, 320, 54, 'RECEBEMOS OS PRODUTOS/SERVICOS CONSTANTES DA PRE-NF-e INDICADA AO LADO', 'Data, identificacao e assinatura do recebedor', 7))
  content.push(field(x + 320, 746, 104, 54, 'NF-e', `No ${nota.numero}\nSerie ${nota.serie}`, 10))
  content.push(field(x + 424, 746, 115, 54, 'AMBIENTE', Number(empresa.ambiente_sefaz || 2) === 1 ? 'Producao' : 'Homologacao', 9))

  content.push(field(x, 686, 186, 52, 'IDENTIFICACAO DO EMITENTE', `${empresa.razao_social}\n${empresa.endereco_logradouro || ''}, ${empresa.endereco_numero || 'SN'}\n${empresa.endereco_cidade || ''}/${empresa.endereco_uf || ''}`, 7))
  content.push(field(x + 186, 686, 122, 52, 'DANFE', `Documento Auxiliar da Nota Fiscal Eletronica\n0-Entrada 1-Saida: 1\nNo ${nota.numero} Serie ${nota.serie}`, 7))
  content.push(field(x + 308, 686, 231, 52, 'CONTROLE DO FISCO / CHAVE DE ACESSO', `${chaveAcesso.replace(/(\d{4})(?=\d)/g, '$1 ')}\nPREVIA SEM AUTORIZACAO SEFAZ`, 7))

  content.push(field(x, 656, 270, 24, 'NATUREZA DA OPERACAO', 'VENDA DE MERCADORIA', 8))
  content.push(field(x + 270, 656, 269, 24, 'PROTOCOLO DE AUTORIZACAO DE USO', protocolo.startsWith('LOCAL') ? 'Pendente de envio SEFAZ' : protocolo, 8))
  content.push(field(x, 628, 180, 24, 'INSCRICAO ESTADUAL', empresa.ie || '-', 8))
  content.push(field(x + 180, 628, 180, 24, 'INSCR. EST. SUBST. TRIB.', '-', 8))
  content.push(field(x + 360, 628, 179, 24, 'CNPJ', formatDoc(empresa.cnpj), 8))

  content.push(pdfText(x, 612, 8, 'DESTINATARIO/REMETENTE', { bold: true }))
  content.push(field(x, 584, 260, 24, 'NOME / RAZAO SOCIAL', nota.destinatario_nome, 8))
  content.push(field(x + 260, 584, 136, 24, 'CNPJ/CPF', formatDoc(nota.destinatario_cpf_cnpj), 8))
  content.push(field(x + 396, 584, 143, 24, 'DATA EMISSAO', new Date().toLocaleDateString('pt-BR'), 8))
  content.push(field(x, 556, 250, 24, 'ENDERECO', `${cliente?.endereco_logradouro || '-'}, ${cliente?.endereco_numero || ''}`, 8))
  content.push(field(x + 250, 556, 118, 24, 'BAIRRO', cliente?.endereco_bairro || '-', 8))
  content.push(field(x + 368, 556, 78, 24, 'CEP', cliente?.endereco_cep || '-', 8))
  content.push(field(x + 446, 556, 93, 24, 'DATA SAIDA', new Date().toLocaleDateString('pt-BR'), 8))
  content.push(field(x, 528, 185, 24, 'MUNICIPIO', cliente?.endereco_cidade || '-', 8))
  content.push(field(x + 185, 528, 50, 24, 'UF', cliente?.endereco_uf || '-', 8))
  content.push(field(x + 235, 528, 120, 24, 'FONE/FAX', cliente?.telefone || '-', 8))
  content.push(field(x + 355, 528, 91, 24, 'INSCRICAO ESTADUAL', cliente?.ie || '-', 8))
  content.push(field(x + 446, 528, 93, 24, 'HORA SAIDA', new Date().toLocaleTimeString('pt-BR'), 8))

  content.push(pdfText(x, 512, 8, 'CALCULO DO IMPOSTO', { bold: true }))
  content.push(field(x, 484, 90, 24, 'BASE ICMS', money(imposto.baseIcms), 7))
  content.push(field(x + 90, 484, 90, 24, 'VALOR ICMS', money(imposto.valorIcms), 7))
  content.push(field(x + 180, 484, 90, 24, 'BASE ICMS ST', money(0), 7))
  content.push(field(x + 270, 484, 90, 24, 'VALOR ICMS ST', money(0), 7))
  content.push(field(x + 360, 484, 90, 24, 'TOTAL PRODUTOS', money(valorProduto), 7))
  content.push(field(x + 450, 484, 89, 24, 'TOTAL NOTA', money(valorProduto), 7))
  content.push(field(x, 456, 90, 24, 'FRETE', money(0), 7))
  content.push(field(x + 90, 456, 90, 24, 'SEGURO', money(0), 7))
  content.push(field(x + 180, 456, 90, 24, 'DESCONTO', money(0), 7))
  content.push(field(x + 270, 456, 90, 24, 'OUTRAS DESP.', money(0), 7))
  content.push(field(x + 360, 456, 90, 24, 'IPI', money(0), 7))
  content.push(field(x + 450, 456, 89, 24, 'PIS/COFINS', money(imposto.valorPis + imposto.valorCofins), 7))

  content.push(pdfText(x, 440, 8, 'ITENS DA NOTA FISCAL', { bold: true }))
  content.push(pdfRect(x, 356, width, 80))
  content.push(pdfText(x + 4, 424, 6, 'CODIGO', { bold: true }))
  content.push(pdfText(x + 58, 424, 6, 'DESCRICAO DO PRODUTO/SERVICO', { bold: true }))
  content.push(pdfText(x + 260, 424, 6, 'NCM', { bold: true }))
  content.push(pdfText(x + 315, 424, 6, 'CFOP', { bold: true }))
  content.push(pdfText(x + 355, 424, 6, 'UN', { bold: true }))
  content.push(pdfText(x + 390, 424, 6, 'QTDE', { bold: true }))
  content.push(pdfText(x + 435, 424, 6, 'V.UNIT', { bold: true }))
  content.push(pdfText(x + 490, 424, 6, 'V.TOTAL', { bold: true }))
  content.push(pdfText(x + 4, 408, 7, produto?.codigo_interno || 'ITEM-1'))
  content.push(pdfText(x + 58, 408, 7, short(nota.descricao, 46)))
  content.push(pdfText(x + 260, 408, 7, digits(produto?.ncm).padStart(8, '0').slice(0, 8)))
  content.push(pdfText(x + 315, 408, 7, digits(produto?.cfop || '5102').padStart(4, '0').slice(0, 4)))
  content.push(pdfText(x + 355, 408, 7, produto?.unidade || 'UN'))
  content.push(pdfText(x + 390, 408, 7, dec(quantidade, 2)))
  content.push(pdfText(x + 435, 408, 7, dec(valorUnitario, 2)))
  content.push(pdfText(x + 490, 408, 7, dec(valorProduto, 2)))

  content.push(pdfText(x, 338, 8, 'DADOS ADICIONAIS', { bold: true }))
  content.push(field(x, 250, 330, 84, 'INFORMACOES COMPLEMENTARES', `PRE-NF-e para conferencia, sem validade fiscal. ${avisos.join(' ')}`, 7))
  content.push(field(x + 330, 250, 209, 84, 'RESERVADO AO FISCO', 'Aguardando assinatura digital, transmissao e autorizacao SEFAZ.', 7))

  content.push(pdfText(x, 232, 7, 'Etapas pendentes para validade fiscal: assinatura XML com certificado A1, envio ao webservice SEFAZ, retorno autorizado e protocolo de uso.'))

  const stream = content.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`,
  ]

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'))
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(pdf, 'utf8')
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'utf8')
}
