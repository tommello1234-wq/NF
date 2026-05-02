import { useEffect, useMemo, useState } from 'react'
import { Download, ReceiptText } from 'lucide-react'
import { toast } from 'sonner'
import { apiGet, apiPostDownload } from '../lib/api'

interface Empresa {
  id: string
  nome: string
  razao_social: string
  cnpj: string
  telefone?: string | null
}

function todayPtBr() {
  return new Date().toLocaleDateString('pt-BR')
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '')
}

function money(value: unknown) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))
}

function isValidPtBrDate(value: string) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return false
  const [day, month, year] = value.split('/').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function Darfs() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [form, setForm] = useState({
    empresa_id: '',
    nome_telefone: '',
    periodo_apuracao: todayPtBr(),
    codigo_receita: '',
    numero_referencia: '',
    data_vencimento: todayPtBr(),
    valor_principal: 10,
    valor_multa: 0,
    valor_juros: 0,
  })

  const total = useMemo(() => (
    Number(form.valor_principal || 0) + Number(form.valor_multa || 0) + Number(form.valor_juros || 0)
  ), [form.valor_principal, form.valor_multa, form.valor_juros])

  useEffect(() => {
    loadEmpresas()
  }, [])

  async function loadEmpresas() {
    setLoading(true)
    try {
      const data = await apiGet<Empresa[]>('/admin/empresas')
      setEmpresas(data)
      if (data[0]) {
        setForm((current) => ({
          ...current,
          empresa_id: data[0].id,
          nome_telefone: [data[0].razao_social || data[0].nome, data[0].telefone].filter(Boolean).join(' / '),
        }))
      }
    } catch (err) {
      toast.error('Erro ao carregar empresas', { description: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }

  function changeEmpresa(empresaId: string) {
    const empresa = empresas.find((item) => item.id === empresaId)
    setForm((current) => ({
      ...current,
      empresa_id: empresaId,
      nome_telefone: empresa
        ? [empresa.razao_social || empresa.nome, empresa.telefone].filter(Boolean).join(' / ')
        : current.nome_telefone,
    }))
  }

  async function gerarDarf() {
    if (!form.empresa_id) {
      toast.warning('Selecione uma empresa')
      return
    }
    if (!isValidPtBrDate(form.periodo_apuracao) || !isValidPtBrDate(form.data_vencimento)) {
      toast.warning('Use datas validas no formato DD/MM/AAAA')
      return
    }
    if (!/^\d{4}$/.test(form.codigo_receita)) {
      toast.warning('Informe o codigo da receita com 4 digitos')
      return
    }
    if (total < 10) {
      toast.warning('O valor total minimo do DARF comum e R$ 10,00')
      return
    }

    setGenerating(true)
    try {
      const blob = await apiPostDownload('/admin/darfs/gerar', {
        ...form,
        codigo_receita: onlyDigits(form.codigo_receita),
        valor_principal: Number(form.valor_principal || 0),
        valor_multa: Number(form.valor_multa || 0),
        valor_juros: Number(form.valor_juros || 0),
      })
      const empresa = empresas.find((item) => item.id === form.empresa_id)
      downloadBlob(blob, `darf-${onlyDigits(empresa?.cnpj || '')}-${form.codigo_receita}.pdf`)
      toast.success('DARF gerado')
    } catch (err) {
      toast.error('Erro ao gerar DARF', { description: (err as Error).message })
    } finally {
      setGenerating(false)
    }
  }

  const input = 'w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30'
  const label = 'mb-1 block text-xs font-medium text-muted-dark'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
            <ReceiptText size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">DARF</h1>
            <p className="text-sm text-muted">Modelo comum com campos oficiais para teste de preenchimento</p>
          </div>
        </div>
      </div>

      <section className="rounded-lg border border-black/[0.06] bg-white p-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="xl:col-span-2">
            <label className={label}>Empresa</label>
            <select
              className={input}
              value={form.empresa_id}
              disabled={loading}
              onChange={(event) => changeEmpresa(event.target.value)}
            >
              <option value="">Selecione</option>
              {empresas.map((empresa) => (
                <option key={empresa.id} value={empresa.id}>
                  {empresa.nome} - {empresa.cnpj}
                </option>
              ))}
            </select>
          </div>
          <div className="xl:col-span-2">
            <label className={label}>Nome/telefone do contribuinte</label>
            <input
              className={input}
              value={form.nome_telefone}
              onChange={(event) => setForm((current) => ({ ...current, nome_telefone: event.target.value }))}
            />
          </div>
          <div>
            <label className={label}>Periodo de apuracao</label>
            <input
              className={input}
              value={form.periodo_apuracao}
              onChange={(event) => setForm((current) => ({ ...current, periodo_apuracao: event.target.value }))}
              placeholder="DD/MM/AAAA"
            />
          </div>
          <div>
            <label className={label}>Codigo da receita</label>
            <input
              className={input}
              maxLength={4}
              value={form.codigo_receita}
              onChange={(event) => setForm((current) => ({ ...current, codigo_receita: onlyDigits(event.target.value).slice(0, 4) }))}
              placeholder="0000"
            />
          </div>
          <div>
            <label className={label}>Numero de referencia</label>
            <input
              className={input}
              value={form.numero_referencia}
              onChange={(event) => setForm((current) => ({ ...current, numero_referencia: event.target.value }))}
            />
          </div>
          <div>
            <label className={label}>Data de vencimento</label>
            <input
              className={input}
              value={form.data_vencimento}
              onChange={(event) => setForm((current) => ({ ...current, data_vencimento: event.target.value }))}
              placeholder="DD/MM/AAAA"
            />
          </div>
          <div>
            <label className={label}>Valor principal</label>
            <input
              className={input}
              type="number"
              min="0"
              step="0.01"
              value={form.valor_principal}
              onChange={(event) => setForm((current) => ({ ...current, valor_principal: Number(event.target.value) }))}
            />
          </div>
          <div>
            <label className={label}>Valor multa</label>
            <input
              className={input}
              type="number"
              min="0"
              step="0.01"
              value={form.valor_multa}
              onChange={(event) => setForm((current) => ({ ...current, valor_multa: Number(event.target.value) }))}
            />
          </div>
          <div>
            <label className={label}>Valor juros</label>
            <input
              className={input}
              type="number"
              min="0"
              step="0.01"
              value={form.valor_juros}
              onChange={(event) => setForm((current) => ({ ...current, valor_juros: Number(event.target.value) }))}
            />
          </div>
          <div>
            <label className={label}>Valor total</label>
            <div className="rounded-lg border border-black/[0.08] bg-light-secondary px-3 py-2 text-sm font-semibold text-dark">
              {money(total)}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-warning/30 bg-warning-bg p-3 text-xs text-warning">
          O DARF numerado com codigo de barras ou PIX deve ser emitido pelo SicalcWeb/Receita. Esta tela gera o modelo comum preenchido para teste operacional.
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={gerarDarf}
            disabled={generating || loading}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            <Download size={16} /> {generating ? 'Gerando...' : 'Gerar PDF DARF'}
          </button>
        </div>
      </section>
    </div>
  )
}
