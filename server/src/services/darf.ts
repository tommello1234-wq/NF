type DarfInput = {
  contribuinteNomeTelefone: string
  periodoApuracao: string
  cpfCnpj: string
  codigoReceita: string
  numeroReferencia?: string | null
  dataVencimento: string
  valorPrincipal: number
  valorMulta: number
  valorJuros: number
  valorTotal: number
}

function pdfEscape(value: unknown) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function ascii(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
}

function money(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value || 0))
}

function pdfText(x: number, y: number, size: number, value: unknown, options?: { bold?: boolean }) {
  const font = options?.bold ? 'F2' : 'F1'
  return `BT /${font} ${size} Tf ${x} ${y} Td (${pdfEscape(ascii(value))}) Tj ET`
}

function pdfRect(x: number, y: number, w: number, h: number) {
  return `${x} ${y} ${w} ${h} re S`
}

function pdfLine(x1: number, y1: number, x2: number, y2: number) {
  return `${x1} ${y1} m ${x2} ${y2} l S`
}

function fieldBox(input: {
  x: number
  y: number
  w: number
  h: number
  code: string
  label: string
  value?: unknown
  alignRight?: boolean
}) {
  const value = ascii(input.value ?? '')
  const valueX = input.alignRight
    ? input.x + input.w - Math.min(Math.max(value.length * 7, 45), input.w - 12)
    : input.x + 8

  return [
    pdfRect(input.x, input.y, input.w, input.h),
    pdfText(input.x + 6, input.y + input.h - 12, 7, `${input.code} ${input.label}`, { bold: true }),
    pdfText(valueX, input.y + 10, 12, value),
  ].join('\n')
}

export function gerarDarfPdf(input: DarfInput) {
  const width = 595
  const height = 842
  const content: string[] = []
  const x = 42
  const topY = 488
  const leftW = 300
  const rightX = x + leftW
  const rightW = 214
  const rowH = 34

  content.push('0.8 w')
  content.push(pdfText(x, 780, 8, 'MINISTERIO DA FAZENDA', { bold: true }))
  content.push(pdfText(x, 766, 8, 'SECRETARIA DA RECEITA FEDERAL DO BRASIL', { bold: true }))
  content.push(pdfText(x + 374, 775, 26, 'DARF', { bold: true }))
  content.push(pdfText(x + 283, 756, 10, 'Documento de Arrecadacao de Receitas Federais', { bold: true }))
  content.push(pdfLine(x, 744, x + leftW + rightW, 744))

  content.push(fieldBox({
    x,
    y: topY + 190,
    w: leftW,
    h: 66,
    code: '01',
    label: 'NOME/TELEFONE',
    value: input.contribuinteNomeTelefone,
  }))

  content.push(pdfRect(x, topY + 82, leftW, 108))
  content.push(pdfText(x + 8, topY + 170, 7, 'INSTRUCOES', { bold: true }))
  content.push(pdfText(x + 8, topY + 150, 8, 'DARF comum para pagamento de receitas federais.'))
  content.push(pdfText(x + 8, topY + 134, 8, 'Preencha o codigo da receita e os valores conforme apuracao.'))
  content.push(pdfText(x + 8, topY + 118, 8, 'A autenticacao bancaria e preenchida pelo agente arrecadador.'))
  content.push(pdfText(x + 8, topY + 98, 8, 'Valor total minimo para recolhimento: R$ 10,00.'))

  const boxes = [
    { code: '02', label: 'PERIODO DE APURACAO', value: input.periodoApuracao },
    { code: '03', label: 'NUMERO DO CPF OU CNPJ', value: input.cpfCnpj },
    { code: '04', label: 'CODIGO DA RECEITA', value: input.codigoReceita },
    { code: '05', label: 'NUMERO DE REFERENCIA', value: input.numeroReferencia || '' },
    { code: '06', label: 'DATA DE VENCIMENTO', value: input.dataVencimento },
    { code: '07', label: 'VALOR DO PRINCIPAL', value: money(input.valorPrincipal), alignRight: true },
    { code: '08', label: 'VALOR DA MULTA', value: money(input.valorMulta), alignRight: true },
    { code: '09', label: 'VALOR DOS JUROS E/OU ENCARGOS DL-1.025/69', value: money(input.valorJuros), alignRight: true },
    { code: '10', label: 'VALOR TOTAL', value: money(input.valorTotal), alignRight: true },
  ]

  boxes.forEach((box, index) => {
    content.push(fieldBox({
      x: rightX,
      y: topY + 222 - (index * rowH),
      w: rightW,
      h: rowH,
      ...box,
    }))
  })

  content.push(fieldBox({
    x,
    y: topY + 20,
    w: leftW + rightW,
    h: 62,
    code: '11',
    label: 'AUTENTICACAO BANCARIA',
    value: '',
  }))

  content.push(pdfText(x, topY - 10, 7, 'Modelo gerado pelo sistema com os campos de preenchimento do DARF comum.'))
  content.push(pdfText(x, topY - 24, 7, 'Para DARF numerado com codigo de barras/PIX, gere pelo servico oficial da Receita/SicalcWeb.'))

  const stream = content.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
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
