/**
 * Spike de emissão NF-e/NFC-e — testa o fluxo completo isolado do painel.
 *
 * O que faz:
 *   1. Verifica saúde da SEFAZ-CE (NfeStatusServico4)
 *   2. Carrega empresa + cert + produto do banco
 *   3. Monta um payload mínimo de NF-e ou NFC-e
 *   4. Chama o orquestrador (que assina e transmite)
 *   5. Mostra a resposta crua da SEFAZ
 *
 * Útil pra ver o cStat exato que a SEFAZ devolve, sem precisar passar pela UI.
 *
 * Uso:
 *   npm run spike:nfe                  # default = NFC-e modelo 65
 *   npm run spike:nfe -- 55            # NF-e A4
 *   npm run spike:nfe -- status        # só health-check (não emite)
 */

import { writeFile } from 'node:fs/promises'
import { supabase } from '../src/services/supabase.js'
import { carregarCertificado } from '../src/services/certificado.js'
import { emitirNfe } from '../src/services/nfe/orquestrador.js'
import {
  consultarStatusServico,
  parseSoapResposta,
  type TransmissaoConfig,
} from '../src/services/nfe/transmissor.js'
import type { NfeInput } from '../src/services/nfe/types.js'

async function main() {
  const arg = process.argv[2] || '65'

  if (arg === 'status') {
    await healthCheck()
    return
  }

  const modelo = (arg === '55' ? 55 : 65) as 55 | 65
  console.log(`\n=== Spike NF-e/NFC-e — modelo ${modelo} ===\n`)

  // 1. Health check
  await healthCheck()

  // 2. Carrega empresa
  const { data: empresas } = await supabase.from('empresas').select('*').order('created_at')
  if (!empresas || empresas.length === 0) {
    throw new Error('Nenhuma empresa cadastrada — rode `npm run seed:teste` primeiro.')
  }
  const empresa = empresas.find((e) => String(e.razao_social || '').includes('TESTE')) || empresas[0]
  console.log(`Empresa: ${empresa.razao_social} (${empresa.cnpj}) — ambiente_sefaz=${empresa.ambiente_sefaz}`)

  // 3. Verifica certificado
  const cert = await carregarCertificado(empresa.id)
  if (!cert) {
    throw new Error('Certificado A1 não cadastrado — suba o PFX em /empresas/<id> primeiro.')
  }
  console.log(`Certificado OK — válido até ${cert.info.validoAte.toISOString().slice(0, 10)}`)

  // 4. Verifica natureza
  const { data: natureza } = await supabase
    .from('naturezas_operacao')
    .select('*')
    .eq('empresa_id', empresa.id)
    .eq('ativo', true)
    .limit(1)
    .maybeSingle()
  if (!natureza) {
    throw new Error('Nenhuma natureza de operação ativa pra empresa.')
  }
  console.log(`Natureza: ${natureza.nome} (CFOP ${natureza.cfop_padrao})`)

  // 5. Verifica produto
  const { data: produtos } = await supabase
    .from('produtos')
    .select('*')
    .eq('empresa_id', empresa.id)
    .eq('ativo', true)
    .eq('tipo', 'produto')
    .limit(1)
  if (!produtos || produtos.length === 0) {
    throw new Error('Nenhum produto cadastrado.')
  }
  const produto = produtos[0]
  console.log(`Produto: ${produto.descricao} (NCM ${produto.ncm}, CSOSN ${produto.cst_csosn})`)

  // 6. Monta payload mínimo e dispara
  const input: NfeInput = {
    empresaId: empresa.id,
    modelo,
    naturezaOperacaoId: natureza.id,
    itens: [
      {
        produtoId: produto.id,
        quantidade: 1,
      },
    ],
    pagamento: {
      forma: '01',                                  // 01 = Dinheiro (mais simples; PIX/cartão exigem dados extras)
      valor: Number(produto.valor_unitario || 100),
    },
  }
  console.log(`\nDisparando emissão…`)
  console.log(JSON.stringify(input, null, 2))

  const t0 = Date.now()
  try {
    const result = await emitirNfe(input)
    const dt = Date.now() - t0
    console.log(`\n→ Concluído em ${dt}ms`)
    console.log(`  status:    ${result.status}`)
    console.log(`  modelo:    ${result.modelo}`)
    console.log(`  série/nº:  ${result.serie}/${result.numero}`)
    console.log(`  chave:     ${result.chaveAcesso}`)
    console.log(`  protocolo: ${result.protocolo || '—'}`)
    if (result.qrCode) console.log(`  qrCode:    ${result.qrCode.slice(0, 80)}…`)
    if (result.erros && result.erros.length > 0) {
      console.log(`\n  erros:`)
      for (const e of result.erros) console.log(`    [${e.codigo}] ${e.descricao}`)
    }
    if (result.rawResponse) {
      console.log(`\n--- Resposta SEFAZ (primeiros 1500 chars) ---`)
      console.log(result.rawResponse.slice(0, 1500))
      console.log(`---`)
    }
  } catch (e) {
    console.error(`\n✗ Falhou em ${Date.now() - t0}ms:`)
    console.error(`  ${(e as Error).message}`)
    if ((e as Error).stack) console.error((e as Error).stack)
    process.exit(1)
  }
}

async function healthCheck() {
  console.log(`Health check SEFAZ-CE…`)
  const { data: empresas } = await supabase.from('empresas').select('*').limit(1)
  if (!empresas || empresas.length === 0) {
    console.log('  ⚠️ Sem empresa cadastrada pra puxar cert — pulando.')
    return
  }
  const empresa = empresas[0]
  const cert = await carregarCertificado(empresa.id)
  if (!cert) {
    console.log('  ⚠️ Sem certificado — pulando health check (precisa de mTLS).')
    return
  }
  for (const modelo of [55, 65] as const) {
    const cfg: TransmissaoConfig = {
      modelo,
      ambiente: (empresa.ambiente_sefaz || 2) as 1 | 2,
      pfxBuffer: cert.pfxBuffer,
      pfxSenha: cert.senha,
    }
    try {
      const res = await consultarStatusServico(cfg)
      const parsed = parseSoapResposta(res.body) as Record<string, unknown>
      console.log(`  ${modelo === 65 ? 'NFC-e' : 'NF-e '}: cStat=${parsed.cStat} — ${parsed.xMotivo}`)
    } catch (e) {
      console.log(`  ${modelo === 65 ? 'NFC-e' : 'NF-e '}: erro — ${(e as Error).message}`)
    }
  }
  console.log('')
}

main().catch((e) => {
  console.error('Falhou:', (e as Error).message || e)
  process.exit(1)
})
