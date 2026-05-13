import { writeFile } from 'node:fs/promises'
import { supabase } from '../src/services/supabase.js'
import { gerarDanfeNfe, gerarDanfeNfceBobina } from '../src/services/nfe/danfe.js'
import { htmlToPdf } from '../src/services/nfe/pdf.js'

const { data: nota } = await supabase
  .from('notas_fiscais')
  .select('*')
  .eq('status', 'autorizada')
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle()

if (!nota) {
  console.log('Nenhuma nota autorizada encontrada')
  process.exit(0)
}

console.log(`Gerando PDF da nota ${nota.tipo} nº ${nota.numero} (${nota.id})...`)

const ehNfce = nota.modelo != null ? Number(nota.modelo) === 65 : nota.tipo === 'nfce'
const html = ehNfce ? await gerarDanfeNfceBobina(nota.id) : await gerarDanfeNfe(nota.id)
const pdf = await htmlToPdf(html, { formato: ehNfce ? 'bobina-80mm' : 'a4' })

const out = `C:\\Users\\felip\\Desktop\\teste-danfe-${nota.tipo}-${nota.numero}.pdf`
await writeFile(out, pdf)
console.log(`✓ PDF gerado em: ${out}`)
console.log(`  Tamanho: ${(pdf.length / 1024).toFixed(1)} KB`)
