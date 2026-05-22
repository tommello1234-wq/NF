/**
 * Carta de Correção Eletrônica (CC-e) — tpEvento = 110110.
 *
 * Usada pra corrigir erros de preenchimento na NF-e que NÃO afetem:
 *   - Variáveis tributárias (alíquota, valor, base, etc.)
 *   - Dados cadastrais que impliquem mudança de remetente/destinatário
 *   - Data de emissão / saída
 *   - Número da nota / série
 *
 * Casos típicos: corrigir CFOP, dados de transporte, info adicional, peso.
 * Prazo: até 30 dias após autorização. Pode ser emitida múltiplas vezes
 * (sempre prevalece a última).
 *
 * Estrutura espelha o evento de cancelamento, trocando descEvento e xCorrecao.
 */

import { create } from 'xmlbuilder2'
import { NFE_NS, type Ambiente } from './types.js'

export interface CartaCorrecaoInput {
  ambiente: Ambiente
  chaveAcesso: string                 // 44 dígitos
  cnpjEmitente: string                // 14 dígitos
  textoCorrecao: string               // 15..1000 chars
  sequencial?: number                 // default 1; SEFAZ permite até 20
  dataHoraEvento?: Date
}

export interface CartaCorrecaoOutput {
  xml: string
  idEvento: string
  tpEvento: string
}

export function buildCartaCorrecaoXml(input: CartaCorrecaoInput): CartaCorrecaoOutput {
  const tpEvento = '110110'
  const seq = input.sequencial ?? 1
  const seqStr = String(seq).padStart(2, '0')

  const chave = input.chaveAcesso.replace(/\D/g, '')
  if (chave.length !== 44) throw new Error(`Chave inválida (${chave.length}): ${chave}`)

  const cnpj = input.cnpjEmitente.replace(/\D/g, '').padStart(14, '0')
  if (cnpj.length !== 14) throw new Error(`CNPJ inválido: ${cnpj}`)

  const texto = (input.textoCorrecao || '').trim()
  if (texto.length < 15 || texto.length > 1000) {
    throw new Error(`Correção precisa ter 15-1000 chars (atual: ${texto.length})`)
  }

  const idEvento = `ID${tpEvento}${chave}${seqStr}`
  const dh = isoBR(input.dataHoraEvento || new Date())

  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('envEvento', { xmlns: NFE_NS, versao: '1.00' })
      .ele('idLote').txt('1').up()
      .ele('evento', { xmlns: NFE_NS, versao: '1.00' })
        .ele('infEvento', { Id: idEvento })
          .ele('cOrgao').txt('23').up()
          .ele('tpAmb').txt(String(input.ambiente)).up()
          .ele('CNPJ').txt(cnpj).up()
          .ele('chNFe').txt(chave).up()
          .ele('dhEvento').txt(dh).up()
          .ele('tpEvento').txt(tpEvento).up()
          .ele('nSeqEvento').txt(String(seq)).up()
          .ele('verEvento').txt('1.00').up()
          .ele('detEvento', { versao: '1.00' })
            .ele('descEvento').txt('Carta de Correcao').up()
            .ele('xCorrecao').txt(texto).up()
            .ele('xCondUso').txt(
              'A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.',
            ).up()
          .up()
        .up()
      .up()

  return {
    xml: doc.end({ prettyPrint: false, headless: false }),
    idEvento,
    tpEvento,
  }
}

function isoBR(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}-03:00`
  )
}
