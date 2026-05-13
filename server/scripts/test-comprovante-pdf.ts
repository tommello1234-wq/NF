import { writeFile } from 'node:fs/promises'
import { supabase } from '../src/services/supabase.js'
import { renderComprovanteAutorizacao } from '../src/services/nfe/comprovantes.js'
import { htmlToPdf } from '../src/services/nfe/pdf.js'

const { data: nota } = await supabase
  .from('notas_fiscais')
  .select('*')
  .eq('status', 'autorizada')
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle()
if (!nota) { console.log('Nenhuma autorizada'); process.exit(0) }

const { data: empresa } = await supabase
  .from('empresas')
  .select('razao_social, cnpj, ie')
  .eq('id', nota.empresa_id)
  .maybeSingle()

console.log('Nota:', nota.id, 'tipo:', nota.tipo, 'modelo:', nota.modelo ?? '(null)')
console.log('Empresa:', empresa?.razao_social)

const html = renderComprovanteAutorizacao({
  empresa: empresa || {},
  nota: {
    numero: nota.numero,
    serie: nota.serie,
    modelo: nota.modelo ?? (nota.tipo === 'nfce' ? 65 : 55),
    chave_acesso: nota.chave_acesso,
    protocolo: nota.protocolo,
    data_autorizacao: nota.data_autorizacao,
    valor_total: nota.valor_total,
    ambiente_nfe: nota.ambiente_nfe ?? 2,
    status: nota.status,
    mensagens_retorno: nota.mensagens_retorno,
  },
})
console.log('HTML gerado:', html.length, 'chars')

try {
  const pdf = await htmlToPdf(html, { formato: 'a4' })
  const out = `C:\\Users\\felip\\Desktop\\teste-comprovante.pdf`
  await writeFile(out, pdf)
  console.log(`✓ PDF: ${out} (${(pdf.length / 1024).toFixed(1)} KB)`)
} catch (e) {
  console.error('Falhou no htmlToPdf:', (e as Error).message)
  if ((e as Error).stack) console.error((e as Error).stack)
  process.exit(1)
}
