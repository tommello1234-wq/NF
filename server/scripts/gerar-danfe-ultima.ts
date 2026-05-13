/**
 * Gera os PDFs (DANFE bobina + DANFE A4 + Comprovante) da última NFC-e
 * autorizada da empresa NORTE-LAB SOBRAL e abre os caminhos.
 */
import { writeFile } from 'node:fs/promises'
import { supabase } from '../src/services/supabase.js'
import { gerarDanfeNfe, gerarDanfeNfceBobina } from '../src/services/nfe/danfe.js'
import { renderComprovanteAutorizacao } from '../src/services/nfe/comprovantes.js'
import { htmlToPdf } from '../src/services/nfe/pdf.js'

async function main() {
  const { data: nota } = await supabase
    .from('notas_fiscais')
    .select('*')
    .eq('empresa_id', 'fb832331-d586-4536-8ef6-1b8469f4fe40')
    .eq('status', 'autorizada')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!nota) { console.error('Nenhuma nota autorizada'); process.exit(1) }

  const { data: empresa } = await supabase
    .from('empresas')
    .select('razao_social, cnpj, ie')
    .eq('id', nota.empresa_id)
    .maybeSingle()

  console.log('🧾 Nota:', nota.tipo, 'nº', nota.numero, '— modelo', nota.modelo)
  console.log('   Chave:', nota.chave_acesso)
  console.log('   Protocolo:', nota.protocolo)

  const ehNfce = nota.modelo != null ? Number(nota.modelo) === 65 : nota.tipo === 'nfce'

  // 1) DANFE bobina (oficial pra NFC-e)
  console.log('\n📄 Gerando DANFE bobina (oficial NFC-e)...')
  try {
    const html = ehNfce ? await gerarDanfeNfceBobina(nota.id) : await gerarDanfeNfe(nota.id)
    const pdf = await htmlToPdf(html, { formato: ehNfce ? 'bobina-80mm' : 'a4' })
    const out = `C:\\Users\\felip\\Desktop\\nfce-${nota.numero}-bobina.pdf`
    await writeFile(out, pdf)
    console.log(`   ✅ ${out} (${(pdf.length / 1024).toFixed(1)} KB)`)
  } catch (e) {
    console.error(`   ❌ ${(e as Error).message}`)
  }

  // 2) DANFE A4 estilo NF-e (mesmo pra NFC-e — formato "estendido")
  console.log('\n📄 Gerando DANFE A4 estilo NF-e (formato estendido)...')
  try {
    const html = await gerarDanfeNfe(nota.id)
    const pdf = await htmlToPdf(html, { formato: 'a4' })
    const out = `C:\\Users\\felip\\Desktop\\nfce-${nota.numero}-a4.pdf`
    await writeFile(out, pdf)
    console.log(`   ✅ ${out} (${(pdf.length / 1024).toFixed(1)} KB)`)
  } catch (e) {
    console.error(`   ❌ ${(e as Error).message}`)
  }

  // 3) Comprovante de autorização SEFAZ
  console.log('\n📄 Gerando Comprovante de Autorização SEFAZ...')
  try {
    const html = renderComprovanteAutorizacao({
      empresa: empresa || {},
      nota: {
        numero: nota.numero,
        serie: nota.serie,
        modelo: nota.modelo ?? (ehNfce ? 65 : 55),
        chave_acesso: nota.chave_acesso,
        protocolo: nota.protocolo,
        data_autorizacao: nota.data_autorizacao,
        valor_total: nota.valor_total,
        ambiente_nfe: nota.ambiente_nfe ?? 2,
        status: nota.status,
        mensagens_retorno: nota.mensagens_retorno,
      },
    })
    const pdf = await htmlToPdf(html, { formato: 'a4' })
    const out = `C:\\Users\\felip\\Desktop\\nfce-${nota.numero}-comprovante.pdf`
    await writeFile(out, pdf)
    console.log(`   ✅ ${out} (${(pdf.length / 1024).toFixed(1)} KB)`)
  } catch (e) {
    console.error(`   ❌ ${(e as Error).message}`)
  }

  console.log('\n💡 Abre os PDFs do desktop pra ver. Lembrando:')
  console.log('   - DANFE bobina = layout oficial da NFC-e (térmica 80mm)')
  console.log('   - DANFE A4     = layout estendido (mesmo da NF-e modelo 55)')
  console.log('   - Comprovante  = recibo de autorização SEFAZ')
}
void main()
