/**
 * Inutilização de numeração de NF-e/NFC-e.
 *
 * Usada quando você "queima" um intervalo de números — por exemplo,
 * gerou os números 100..105 mas só 100..102 foram emitidos com sucesso
 * e 103..105 ficaram com erro técnico antes de transmitir. Pra manter
 * a sequência fiscal contínua você inutiliza 103..105 na SEFAZ.
 *
 * Refs:
 *   - MOC NF-e v7.00, capítulo 7
 *   - Schema XSD: inutNFe_v4.00.xsd
 *
 * Estrutura:
 *   <inutNFe versao="4.00">
 *     <infInut Id="ID<cUF(2)><CNPJ(14)><mod(2)><serie(3)><nNFini(9)><nNFfin(9)>">
 *       <tpAmb>1|2</tpAmb>
 *       <xServ>INUTILIZAR</xServ>
 *       <cUF>23</cUF>
 *       <ano>YY</ano>
 *       <CNPJ>...</CNPJ>
 *       <mod>55|65</mod>
 *       <serie>...</serie>
 *       <nNFIni>...</nNFIni>
 *       <nNFFin>...</nNFFin>
 *       <xJust>15-255 chars</xJust>
 *     </infInut>
 *     <Signature/>
 *   </inutNFe>
 *
 * ⚠️ ESQUELETO DE TESTE.
 */

import { create } from 'xmlbuilder2'
import { NFE_NS, type Ambiente, type Modelo } from './types.js'

export interface InutilizacaoInput {
  ambiente: Ambiente
  cnpjEmitente: string                // 14 dígitos
  modelo: Modelo                       // 55 ou 65
  serie: number
  numeroInicial: number
  numeroFinal: number
  ano?: number                         // default = ano atual (YY do Id)
  justificativa: string                // 15..255 chars
}

export interface InutilizacaoOutput {
  xml: string
  idInut: string
}

export function buildInutilizacaoXml(input: InutilizacaoInput): InutilizacaoOutput {
  const cnpj = input.cnpjEmitente.replace(/\D/g, '').padStart(14, '0')
  if (cnpj.length !== 14) throw new Error(`CNPJ inválido: ${cnpj}`)

  if (input.numeroInicial > input.numeroFinal) {
    throw new Error('numeroInicial > numeroFinal')
  }

  const justificativa = (input.justificativa || '').trim()
  if (justificativa.length < 15 || justificativa.length > 255) {
    throw new Error(`Justificativa precisa ter 15-255 chars (atual: ${justificativa.length})`)
  }

  const cUF = '23'
  const mod = String(input.modelo).padStart(2, '0')
  const ano = String(input.ano ?? new Date().getFullYear()).slice(-2)
  const serie = String(input.serie).padStart(3, '0')
  const nIni = String(input.numeroInicial).padStart(9, '0')
  const nFin = String(input.numeroFinal).padStart(9, '0')

  const idInut = `ID${cUF}${cnpj}${mod}${serie}${nIni}${nFin}`

  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('inutNFe', { xmlns: NFE_NS, versao: '4.00' })
      .ele('infInut', { Id: idInut })
        .ele('tpAmb').txt(String(input.ambiente)).up()
        .ele('xServ').txt('INUTILIZAR').up()
        .ele('cUF').txt(cUF).up()
        .ele('ano').txt(ano).up()
        .ele('CNPJ').txt(cnpj).up()
        .ele('mod').txt(mod).up()
        .ele('serie').txt(String(input.serie)).up()
        .ele('nNFIni').txt(String(input.numeroInicial)).up()
        .ele('nNFFin').txt(String(input.numeroFinal)).up()
        .ele('xJust').txt(justificativa).up()
      .up()

  return {
    xml: doc.end({ prettyPrint: false, headless: false }),
    idInut,
  }
}
