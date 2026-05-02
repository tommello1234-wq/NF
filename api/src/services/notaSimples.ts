type NotaSimpleInput = {
  empresa: {
    cnpj: string
    razao_social: string
    nome: string
    endereco_logradouro?: string | null
    endereco_numero?: string | null
    endereco_bairro?: string | null
    endereco_cidade?: string | null
    endereco_uf?: string | null
    endereco_cep?: string | null
  }
  nota: {
    tipo: 'nfe' | 'nfce'
    numero: number
    serie: number
    destinatario_nome: string
    destinatario_cpf_cnpj: string
    descricao: string
    valor_total: number
  }
  chaveAcesso: string
  protocolo: string
}

function digits(value: unknown) {
  return String(value || '').replace(/\D/g, '')
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

export function gerarXmlSimples({ empresa, nota, chaveAcesso, protocolo }: NotaSimpleInput) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<notaFiscalSimples>
  <aviso>Documento simplificado para teste operacional. Nao possui validade fiscal.</aviso>
  <tipo>${xmlEscape(nota.tipo.toUpperCase())}</tipo>
  <numero>${xmlEscape(nota.numero)}</numero>
  <serie>${xmlEscape(nota.serie)}</serie>
  <chaveAcesso>${xmlEscape(chaveAcesso)}</chaveAcesso>
  <protocolo>${xmlEscape(protocolo)}</protocolo>
  <emitidaEm>${new Date().toISOString()}</emitidaEm>
  <emitente>
    <cnpj>${xmlEscape(digits(empresa.cnpj))}</cnpj>
    <razaoSocial>${xmlEscape(empresa.razao_social)}</razaoSocial>
    <nomeFantasia>${xmlEscape(empresa.nome)}</nomeFantasia>
    <endereco>${xmlEscape([
      empresa.endereco_logradouro,
      empresa.endereco_numero,
      empresa.endereco_bairro,
      empresa.endereco_cidade,
      empresa.endereco_uf,
      empresa.endereco_cep,
    ].filter(Boolean).join(', '))}</endereco>
  </emitente>
  <destinatario>
    <nome>${xmlEscape(nota.destinatario_nome)}</nome>
    <documento>${xmlEscape(digits(nota.destinatario_cpf_cnpj))}</documento>
  </destinatario>
  <itens>
    <item numero="1">
      <descricao>${xmlEscape(nota.descricao)}</descricao>
      <quantidade>1</quantidade>
      <valorUnitario>${xmlEscape(nota.valor_total.toFixed(2))}</valorUnitario>
      <valorTotal>${xmlEscape(nota.valor_total.toFixed(2))}</valorTotal>
    </item>
  </itens>
  <valorTotal>${xmlEscape(nota.valor_total.toFixed(2))}</valorTotal>
</notaFiscalSimples>
`
}

function pdfEscape(value: unknown) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

export function gerarDanfeSimples({ empresa, nota, chaveAcesso, protocolo }: NotaSimpleInput) {
  const lines = [
    'NOTA FISCAL SIMPLES - TESTE OPERACIONAL',
    'Sem validade fiscal / sem transmissao SEFAZ',
    `${nota.tipo.toUpperCase()} ${nota.numero} / Serie ${nota.serie}`,
    `Chave: ${chaveAcesso}`,
    `Protocolo: ${protocolo}`,
    `Emitente: ${empresa.razao_social}`,
    `CNPJ: ${digits(empresa.cnpj)}`,
    `Destinatario: ${nota.destinatario_nome}`,
    `Descricao: ${nota.descricao}`,
    `Valor total: R$ ${nota.valor_total.toFixed(2)}`,
  ]

  const text = lines.map((line, index) => {
    const y = 770 - index * 24
    return `BT /F1 12 Tf 56 ${y} Td (${pdfEscape(line)}) Tj ET`
  }).join('\n')

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text, 'utf8')} >>\nstream\n${text}\nendstream`,
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
