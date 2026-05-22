/** Replica exatamente o que a rota /admin/nfe/:id/danfe.pdf faz. */
import { writeFile } from 'node:fs/promises'
import { supabase } from '../src/services/supabase.js'
import { gerarDanfeNfe, gerarDanfeNfceBobina } from '../src/services/nfe/danfe.js'
import { htmlToPdf } from '../src/services/nfe/pdf.js'

const { data: notas, error } = await supabase
  .from('notas_fiscais')
  .select('*')
  .eq('status', 'autorizada')
  .order('created_at', { ascending: false })
  .limit(5)
if (error) { console.error('Erro:', error.message); process.exit(1) }
console.log(`Encontradas ${notas?.length ?? 0} notas autorizadas`)

for (const nota of notas || []) {
  console.log(`\n--- Testando nota ${nota.tipo} nº ${nota.numero} (${nota.id}) ---`)
  try {
    const ehNfce = nota.modelo != null ? Number(nota.modelo) === 65 : nota.tipo === 'nfce'
    console.log(`  ehNfce=${ehNfce} (modelo=${nota.modelo}, tipo=${nota.tipo})`)
    const html = ehNfce
      ? await gerarDanfeNfceBobina(nota.id)
      : await gerarDanfeNfe(nota.id)
    console.log(`  HTML gerado: ${html.length} chars`)
    const pdf = await htmlToPdf(html, { formato: ehNfce ? 'bobina-80mm' : 'a4' })
    const out = `C:\\Users\\felip\\Desktop\\test-route-${nota.tipo}-${nota.numero}.pdf`
    await writeFile(out, pdf)
    console.log(`  ✓ PDF: ${out} (${(pdf.length / 1024).toFixed(1)} KB)`)
  } catch (e) {
    console.error(`  ✗ FALHOU: ${(e as Error).message}`)
    if ((e as Error).stack) console.error((e as Error).stack)
  }
}
