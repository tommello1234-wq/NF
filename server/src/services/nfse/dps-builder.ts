import { create } from 'xmlbuilder2'
import type { DpsInput, EnderecoDps, TomadorDps } from './types.js'
import { NFSE_NS, VERSAO_DPS } from './types.js'

/**
 * Monta o XML de uma DPS conforme schema oficial Padrão Nacional (v1.01).
 * O XML retornado AINDA NÃO está assinado — passe pro xml-signer depois.
 *
 * Regras de formação do Id da infDPS (45 caracteres):
 *   "DPS"
 *   + cMunIBGE_emissor (7)
 *   + tipoInscricao (1)        — sempre 2 (CNPJ) por enquanto
 *   + inscricaoFederal (14)    — CNPJ
 *   + serie (5, padded com 0)
 *   + nDPS (15, padded com 0)
 *
 * O XML é serializado SEM indentação porque whitespace altera o digest da
 * assinatura. Atributos são canonicalizados pelo xml-signer depois.
 */
export function buildDpsXml(input: DpsInput): { xml: string; idDps: string } {
  const cMunEmi = input.codigoMunicipioEmissor.padStart(7, '0')
  const cnpj = input.prestador.cnpj.padStart(14, '0')
  const tipoInsc = '2' // 1=CPF, 2=CNPJ

  // No XSD:
  //   - <serie> (TSSerieDPS) é string até 5 chars
  //   - <nDPS>  (TSNumDPS) é string até 15 chars, pattern [1-9][0-9]{0,14}
  //     => não pode ter zeros à esquerda no campo standalone
  //   - Id é "DPS" + cMun(7) + tpInsc(1) + nInsc(14) + serie(5 pad) + nDPS(15 pad)
  const serieValor = String(input.serie)
  const nDpsValor = String(input.numero)
  if (!/^[1-9][0-9]{0,14}$/.test(nDpsValor)) {
    throw new Error(`numero da DPS inválido (deve ser 1..999999999999999): ${nDpsValor}`)
  }

  const seriePad = serieValor.padStart(5, '0')
  const nDpsPad = nDpsValor.padStart(15, '0')
  const idDps = `DPS${cMunEmi}${tipoInsc}${cnpj}${seriePad}${nDpsPad}`
  if (idDps.length !== 45) {
    throw new Error(`Id DPS inválido (${idDps.length} chars): ${idDps}`)
  }

  const dhEmi = isoUtc(input.dataEmissao)
  const dCompet = ymd(input.dataCompetencia)
  const verAplic = (input.versaoAplicativo || 'NFSE-API-1.0').slice(0, 20)
  const localPrest = input.servico.localPrestacaoCodigoMunicipio || cMunEmi

  const doc = create({ version: '1.0', encoding: 'UTF-8' })
  const dps = doc.ele('DPS', { xmlns: NFSE_NS, versao: VERSAO_DPS })
  const inf = dps.ele('infDPS', { Id: idDps })

  inf.ele('tpAmb').txt(String(input.ambiente))
  inf.ele('dhEmi').txt(dhEmi)
  inf.ele('verAplic').txt(verAplic)
  inf.ele('serie').txt(serieValor)
  inf.ele('nDPS').txt(nDpsValor)
  inf.ele('dCompet').txt(dCompet)
  inf.ele('tpEmit').txt('1') // 1=Prestador
  inf.ele('cLocEmi').txt(cMunEmi)

  // === prest ===
  const prest = inf.ele('prest')
  prest.ele('CNPJ').txt(cnpj)
  prest.ele('IM').txt(input.prestador.inscricaoMunicipal)
  prest.ele('xNome').txt(input.prestador.nome)
  const regTrib = prest.ele('regTrib')
  regTrib.ele('opSimpNac').txt(String(input.prestador.regimeTributario.opSimpNac))
  regTrib.ele('regApTribSN').txt(String(input.prestador.regimeTributario.regApTribSN ?? 1))
  regTrib.ele('regEspTrib').txt(String(input.prestador.regimeTributario.regEspTrib))

  // === toma === (TCInfoPessoa: choice → CAEPF? → IM? → xNome → end? → fone? → email?)
  const toma = inf.ele('toma')
  appendTomadorIdentificacao(toma, input.tomador)
  toma.ele('xNome').txt(input.tomador.nome)
  if (input.tomador.endereco) appendEndereco(toma.ele('end'), input.tomador.endereco)

  // === serv ===
  const serv = inf.ele('serv')
  const loc = serv.ele('locPrest')
  loc.ele('cLocPrestacao').txt(localPrest)
  const cServ = serv.ele('cServ')
  cServ.ele('cTribNac').txt(input.servico.codigoTributacaoNacional)
  if (input.servico.codigoTributacaoMunicipal) {
    cServ.ele('cTribMun').txt(input.servico.codigoTributacaoMunicipal)
  }
  cServ.ele('xDescServ').txt(input.servico.descricao)
  if (input.servico.codigoNBS) cServ.ele('cNBS').txt(input.servico.codigoNBS)

  // === valores ===
  const valores = inf.ele('valores')
  valores.ele('vServPrest').ele('vServ').txt(money(input.valores.valorServicos))
  const trib = valores.ele('trib')
  const tribMun = trib.ele('tribMun')
  tribMun.ele('tribISSQN').txt('1') // 1=Operação tributável
  tribMun.ele('tpRetISSQN').txt(input.valores.issRetido ? '1' : '2') // 1=Retido, 2=Não retido
  tribMun.ele('pAliq').txt(money(input.valores.aliquotaIss))
  trib.ele('totTrib').ele('indTotTrib').txt('0') // 0=Não informar valor estimado

  const xml = doc.end({ headless: false, prettyPrint: false })
  return { xml, idDps }
}

// === helpers ===

function appendTomadorIdentificacao(parent: ReturnType<typeof create>, tomador: TomadorDps) {
  if (tomador.cpf) {
    parent.ele('CPF').txt(onlyDigits(tomador.cpf))
  } else if (tomador.cnpj) {
    parent.ele('CNPJ').txt(onlyDigits(tomador.cnpj))
  } else {
    throw new Error('Tomador precisa de CPF ou CNPJ')
  }
}

function appendEndereco(parent: ReturnType<typeof create>, e: EnderecoDps) {
  // TCEndereco: choice(endNac, endExt) → xLgr → nro → xCpl? → xBairro
  const endNac = parent.ele('endNac')
  endNac.ele('cMun').txt(e.codigoMunicipio)
  endNac.ele('CEP').txt(onlyDigits(e.cep))

  parent.ele('xLgr').txt(e.logradouro)
  parent.ele('nro').txt(e.numero)
  if (e.complemento) parent.ele('xCpl').txt(e.complemento)
  parent.ele('xBairro').txt(e.bairro)
}

function isoUtc(d: Date): string {
  // Sempre serializa em horário de Brasília (UTC-3), independente do timezone
  // do servidor (Vercel roda em UTC). E subtrai 60s pra evitar clock skew
  // contra o servidor SEFIN — erro E0008 acontece quando dhEmi está alguns
  // milissegundos à frente do relógio do SEFIN.
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  const TZ_OFFSET_MIN = -180 // -03:00
  const adjusted = new Date(d.getTime() - 60_000 + TZ_OFFSET_MIN * 60_000)
  // adjusted está agora em UTC com horário local Brasília menos 60s.
  // Vamos extrair YYYY-MM-DDTHH:mm:ss diretamente dos componentes UTC.
  const Y = adjusted.getUTCFullYear()
  const M = pad(adjusted.getUTCMonth() + 1)
  const D = pad(adjusted.getUTCDate())
  const h = pad(adjusted.getUTCHours())
  const m = pad(adjusted.getUTCMinutes())
  const s = pad(adjusted.getUTCSeconds())
  return `${Y}-${M}-${D}T${h}:${m}:${s}-03:00`
}

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function money(n: number): string {
  return n.toFixed(2)
}

function onlyDigits(s: string): string {
  return (s || '').replace(/\D/g, '')
}
