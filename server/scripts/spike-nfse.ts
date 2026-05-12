/**
 * Spike de validação de assinatura XMLDSIG + mTLS contra Produção Restrita
 * (homologação) do Padrão Nacional NFS-e.
 *
 * Como rodar (com PFX local):
 *
 *   PFX_FILE=/caminho/para/certificado.pfx \
 *   PFX_PASSWORD='senha-do-cert' \
 *   EMPRESA_IM='inscricao-municipal-mucambo' \
 *   npm run spike:nfse --workspace server
 *
 * Variáveis opcionais:
 *   NFSE_AMBIENTE=2     (default 2 = homologação)
 *   CMUN=2309003        (default Mucambo/CE)
 *   CNPJ=...            (default 41911178000171 = UPWARD CREATIVE ACADEMY)
 *   NOME_PRESTADOR=...  (default "UPWARD CREATIVE ACADEMY LTDA")
 *
 * O script:
 *   1) Lê o PFX e extrai chave/cert (PEM)
 *   2) Monta uma DPS de teste mínima
 *   3) Assina com XMLDSIG (xml-crypto)
 *   4) Comprime (gzip + base64)
 *   5) Faz GET /parametros_municipais/{cMun}/convenio (sanity de mTLS)
 *   6) Faz POST /nfse com a DPS
 *   7) Loga status, headers e body crus
 *
 * Saída esperada na fase 1: SEFIN deve responder 200 ou 400 com mensagens
 * estruturadas. Status 0 / EPROTO indica falha de mTLS (cert errado, sem
 * credenciamento). 422 / 400 com mensagem de schema indica que mTLS funcionou
 * mas a DPS precisa ajustes.
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  buildDpsXml,
  carregarMaterialPfx,
  compressGzipBase64,
  criarMtlsAgent,
  getConvenioMunicipio,
  postDps,
  signDps,
  type Ambiente,
  type DpsInput,
} from '../src/services/nfse/index.js'

async function main() {
  const pfxFile = req('PFX_FILE')
  const pfxPassword = req('PFX_PASSWORD')
  const im = process.env.EMPRESA_IM?.trim() || '0'
  const ambiente = (Number(process.env.NFSE_AMBIENTE || 2) as Ambiente)
  const cMun = process.env.CMUN?.trim() || '2309003' // Mucambo/CE
  const cnpj = process.env.CNPJ?.trim() || '41911178000171'
  const nomePrestador = process.env.NOME_PRESTADOR?.trim() || 'UPWARD CREATIVE ACADEMY LTDA'
  const tomadorCpf = process.env.TOMADOR_CPF?.trim() || '00000000000'
  const tomadorCnpj = process.env.TOMADOR_CNPJ?.trim() || ''
  const tomadorNome = process.env.TOMADOR_NOME?.trim() || 'TOMADOR DE TESTE - HOMOLOGACAO'

  log('1. Lendo PFX em', pfxFile)
  const pfxBuffer = fs.readFileSync(path.resolve(pfxFile))
  const pfx = carregarMaterialPfx(pfxBuffer, pfxPassword)
  log('   subject CN extraído (1ª linha do cert):',
    pfx.certificatePem.split('\n').slice(1, 2).join('').slice(0, 40) + '...'
  )
  log('   chave privada PEM:', pfx.privateKeyPem.startsWith('-----BEGIN') ? 'OK' : 'FALHA')
  log('   CAs intermediárias:', pfx.caChainPem.length)

  log('2. Montando DPS de teste')
  const input: DpsInput = {
    ambiente,
    serie: 1,
    numero: Date.now() % 1_000_000_000_000_000, // dummy mas único
    dataEmissao: new Date(),
    dataCompetencia: new Date(),
    codigoMunicipioEmissor: cMun,
    versaoAplicativo: 'SPIKE-1.0',
    prestador: {
      cnpj,
      inscricaoMunicipal: im,
      nome: nomePrestador,
      regimeTributario: { opSimpNac: 3, regApTribSN: 1, regEspTrib: 0 },
    },
    tomador: {
      ...(tomadorCnpj ? { cnpj: tomadorCnpj } : { cpf: tomadorCpf }),
      nome: tomadorNome,
      endereco: {
        logradouro: 'Rua dos Testes',
        numero: '100',
        bairro: 'Centro',
        codigoMunicipio: cMun,
        cep: '62170000',
      },
    },
    servico: {
      codigoTributacaoNacional: '010501', // 1.05 LC116 (licenciamento) com desdobro 01
      descricao: 'Spike de teste — emissao de homologacao',
      localPrestacaoCodigoMunicipio: cMun,
    },
    valores: {
      valorServicos: 1.00,
      aliquotaIss: 0,
      issRetido: false,
    },
  }

  const { xml, idDps } = buildDpsXml(input)
  log('   Id DPS:', idDps)
  log('   XML não assinado (primeiros 200 chars):', xml.slice(0, 200) + '...')

  log('3. Assinando XML (XMLDSIG, exclusive C14N, RSA-SHA256)')
  let signedXml: string
  try {
    signedXml = signDps(xml, idDps, pfx)
    log('   <Signature> embutida — ok')
  } catch (e) {
    log('   FALHA ao assinar:', (e as Error).message)
    throw e
  }

  // Salva o assinado pra inspeção
  const outDir = path.resolve('/tmp/spike-nfse')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'dps-signed.xml'), signedXml, 'utf-8')
  log('   XML assinado salvo em /tmp/spike-nfse/dps-signed.xml')

  log('4. Comprimindo GZip+Base64')
  const dpsB64 = compressGzipBase64(signedXml)
  log('   tamanho base64:', dpsB64.length, 'chars')

  log('5. Criando https.Agent com mTLS (skip server verify — só pra spike)')
  const agent = criarMtlsAgent(pfx, { insecureSkipServerVerify: true })
  const deps = { agent, ambiente }

  log('6. Sanity check: GET /parametros_municipais/' + cMun + '/convenio')
  try {
    const conv = await getConvenioMunicipio(deps, cMun)
    log('   status:', conv.status)
    log('   content-type:', conv.contentType)
    log('   body (primeiros 500):', conv.body.slice(0, 500))
  } catch (e) {
    log('   FALHA na chamada (mTLS provavelmente):', (e as Error).message)
  }

  log('7. Tentando emissão: POST /nfse')
  try {
    const res = await postDps(deps, dpsB64)
    log('   status:', res.status)
    log('   content-type:', res.contentType)
    log('   body completo:')
    log(res.body)
    fs.writeFileSync(path.join(outDir, 'response.txt'), res.body, 'utf-8')
    log('   resposta salva em /tmp/spike-nfse/response.txt')
  } catch (e) {
    log('   FALHA na chamada:', (e as Error).message)
  }
}

function req(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`[spike] env var obrigatória ausente: ${name}`)
    process.exit(2)
  }
  return v
}

function log(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log(...args)
}

main().catch((e) => {
  console.error('[spike] erro fatal:', e)
  process.exit(1)
})
