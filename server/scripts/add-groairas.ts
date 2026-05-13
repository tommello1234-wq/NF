/**
 * Adiciona a empresa de Groaíras (Ótica Princesa Groaíras / RENAYRA M X OTICA LTDA)
 * SEM apagar nada que já existe.
 *
 * Dados:
 *   - Cert PFX (senha 123456)
 *   - Endereço/telefones do comprovante-venda-13119.pdf
 *
 * Idempotente: se a empresa já existir (por CNPJ), só atualiza nome fantasia
 * e re-sobe o cert.
 */

import { readFile } from 'node:fs/promises'
import { supabase } from '../src/services/supabase.js'
import { lerMetadadosPfx, salvarCertificado } from '../src/services/certificado.js'

const PFX_GROAIRAS = 'C:\\Users\\felip\\Desktop\\Arquivos\\CERTIFICADOS DIGITAIS\\CERTIFICADO DE GROAÍRAS (2).pfx'
const SENHA = '123456'

const DADOS = {
  // razao_social vem do cert (RENAYRA M X OTICA LTDA)
  // CNPJ vem do cert (09545371000123)
  nome_fantasia: 'Ótica Princesa Groaíras',
  endereco_logradouro: 'Manoel Gerônimo',
  endereco_numero: '85',
  endereco_bairro: 'Centro',
  endereco_cidade: 'Groaíras',
  endereco_uf: 'CE',
  endereco_codigo_ibge: '2304657',
  telefone: '8898383160',
}

async function main() {
  const pfxBuffer = await readFile(PFX_GROAIRAS)
  const info = lerMetadadosPfx(pfxBuffer, SENHA)
  if (!info) throw new Error('PFX não decriptou — senha errada')
  console.log(`Cert: ${info.razaoSocial} (CNPJ ${info.cnpj}, válido até ${info.validoAte.toISOString().slice(0, 10)})`)

  // Idempotência por CNPJ
  const { data: existente } = await supabase
    .from('empresas')
    .select('id')
    .eq('cnpj', info.cnpj)
    .maybeSingle()

  let empresaId: string
  if (existente) {
    console.log(`Empresa já existe (id=${existente.id}) — atualizando nome fantasia.`)
    const { error } = await supabase
      .from('empresas')
      .update({ nome: DADOS.nome_fantasia, razao_social: info.razaoSocial })
      .eq('id', existente.id)
    if (error) throw new Error(error.message)
    empresaId = existente.id as string
  } else {
    const { data, error } = await supabase
      .from('empresas')
      .insert({
        nome: DADOS.nome_fantasia,
        razao_social: info.razaoSocial,
        cnpj: info.cnpj,
        ie: null,
        regime_tributario: 'simples',
        crt: 1,
        endereco_logradouro: DADOS.endereco_logradouro,
        endereco_numero: DADOS.endereco_numero,
        endereco_bairro: DADOS.endereco_bairro,
        endereco_cidade: DADOS.endereco_cidade,
        endereco_uf: DADOS.endereco_uf,
        endereco_cep: null,
        endereco_codigo_ibge: DADOS.endereco_codigo_ibge,
        telefone: DADOS.telefone,
        email: null,
        ambiente_sefaz: 2,
        uf_sefaz: 'CE',
        serie_nfe: 1,
        proximo_numero_nfe: 1,
        serie_nfce: 1,
        proximo_numero_nfce: 1,
        tipo_emissao_habilitado: 'teste_local',
        status_fiscal: 'incompleta',
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`Erro ao criar empresa: ${error?.message}`)
    empresaId = data.id as string
  }

  // Upload cert
  await salvarCertificado({ empresaId, pfxBuffer, senha: SENHA, info })

  console.log(`\n✓ Empresa: ${empresaId}`)
  console.log(`   Nome:        ${DADOS.nome_fantasia}`)
  console.log(`   Razão soc:   ${info.razaoSocial}`)
  console.log(`   CNPJ:        ${info.cnpj}`)
  console.log(`   Endereço:    ${DADOS.endereco_logradouro}, ${DADOS.endereco_numero}`)
  console.log(`                ${DADOS.endereco_bairro} - ${DADOS.endereco_cidade}/${DADOS.endereco_uf}`)
  console.log(`   IBGE:        ${DADOS.endereco_codigo_ibge}`)
  console.log(`   Telefone:    ${DADOS.telefone}`)
  console.log(`\n✓ Certificado A1 uploadado (válido até ${info.validoAte.toISOString().slice(0, 10)})`)

  console.log(`\n⚠️  Em branco (preencha em /empresas/${empresaId}):`)
  console.log(`   IE (Inscrição Estadual)`)
  console.log(`   IM (Inscrição Municipal) — só pra NFS-e`)
  console.log(`   CEP`)
  console.log(`   Email`)
  console.log(`   CSC homol (ID + Token) — pra NFC-e`)
}

main().catch((e) => {
  console.error('Falhou:', (e as Error).message || e)
  process.exit(1)
})
