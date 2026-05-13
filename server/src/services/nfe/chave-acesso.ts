/**
 * Geração da chave de acesso de 44 dígitos da NF-e/NFC-e.
 *
 * Estrutura (Anexo XII MOC):
 *   cUF (2) + AAMM (4) + CNPJ (14) + mod (2) + serie (3) + nNF (9)
 *   + tpEmis (1) + cNF (8) + cDV (1)
 *
 * Total: 44 dígitos.
 *
 * cDV é o dígito verificador calculado por módulo 11 dos 43 dígitos anteriores
 * com pesos 2..9 ciclando.
 */

import type { Modelo, FormaEmissao } from './types.js'
import { CODIGO_UF } from './types.js'

export interface ChaveAcessoInput {
  uf: keyof typeof CODIGO_UF       // 'CE' por enquanto
  dataEmissao: Date
  cnpjEmitente: string             // 14 dígitos
  modelo: Modelo                    // 55 ou 65
  serie: number                     // 0..999
  numero: number                    // 1..999.999.999
  tipoEmissao: FormaEmissao         // tpEmis (1=normal)
  /** Código numérico aleatório (cNF) — 8 dígitos. Se não fornecido, gera aleatório. */
  codigoNumerico?: number
}

export interface ChaveAcessoOutput {
  chave: string                     // 44 chars
  cnf: string                       // 8 chars (parte da chave)
  cdv: string                       // 1 char (dígito verificador)
}

export function gerarChaveAcesso(input: ChaveAcessoInput): ChaveAcessoOutput {
  const cUF = String(CODIGO_UF[input.uf]).padStart(2, '0')

  const ano = String(input.dataEmissao.getFullYear()).slice(-2)
  const mes = String(input.dataEmissao.getMonth() + 1).padStart(2, '0')
  const aamm = `${ano}${mes}`

  const cnpj = input.cnpjEmitente.replace(/\D/g, '').padStart(14, '0')
  if (cnpj.length !== 14) throw new Error(`CNPJ inválido: ${input.cnpjEmitente}`)

  const mod = String(input.modelo).padStart(2, '0')
  const serie = String(input.serie).padStart(3, '0')
  const nNF = String(input.numero).padStart(9, '0')
  const tpEmis = String(input.tipoEmissao)

  // cNF: 8 dígitos numéricos, NÃO pode ser igual a nNF (regra A03 SEFAZ).
  const cnfNum =
    input.codigoNumerico ??
    Math.floor(10_000_000 + Math.random() * 89_999_999)
  const cnf = String(cnfNum).padStart(8, '0').slice(-8)

  if (cnf === nNF.slice(-8)) {
    // Re-roll simples se colidiu
    return gerarChaveAcesso({ ...input, codigoNumerico: undefined })
  }

  const base43 = `${cUF}${aamm}${cnpj}${mod}${serie}${nNF}${tpEmis}${cnf}`
  const cdv = calcularDigitoVerificador(base43)
  const chave = `${base43}${cdv}`

  if (chave.length !== 44) {
    throw new Error(`Chave gerada com tamanho inválido: ${chave.length}`)
  }
  return { chave, cnf, cdv }
}

/** Módulo 11, pesos 2..9 cíclicos, da direita pra esquerda. */
export function calcularDigitoVerificador(base43: string): string {
  if (!/^\d{43}$/.test(base43)) {
    throw new Error(`Base de 43 dígitos esperada, recebido: ${base43.length}`)
  }
  let soma = 0
  let peso = 2
  for (let i = base43.length - 1; i >= 0; i--) {
    soma += Number(base43[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  const resto = soma % 11
  const dv = resto < 2 ? 0 : 11 - resto
  return String(dv)
}

/** Quebra a chave de acesso em componentes (útil pra debug / DANFE). */
export function parseChaveAcesso(chave: string): {
  cUF: string
  aamm: string
  cnpj: string
  modelo: string
  serie: string
  numero: string
  tpEmis: string
  cNF: string
  cDV: string
} {
  const c = chave.replace(/\D/g, '')
  if (c.length !== 44) throw new Error(`Chave deve ter 44 dígitos: ${c.length}`)
  return {
    cUF: c.slice(0, 2),
    aamm: c.slice(2, 6),
    cnpj: c.slice(6, 20),
    modelo: c.slice(20, 22),
    serie: c.slice(22, 25),
    numero: c.slice(25, 34),
    tpEmis: c.slice(34, 35),
    cNF: c.slice(35, 43),
    cDV: c.slice(43, 44),
  }
}
