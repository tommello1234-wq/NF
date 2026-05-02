import { useEffect, useMemo, useState } from 'react'
import { Edit2, Plus, RefreshCw, Settings2, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/api'

interface Empresa {
  id: string
  nome: string
  cnpj: string
}

interface NaturezaOperacao {
  id: string
  empresa_id: string
  nome: string
  natureza: string
  tipo_operacao: 'entrada' | 'saida'
  finalidade: 'normal' | 'complementar' | 'ajuste' | 'devolucao'
  cfop_padrao: string | null
  consumidor_final: boolean
  indicador_presenca: number
  modalidade_frete: number
  informacoes_adicionais: string | null
  ativo: boolean
}

const emptyNatureza: NaturezaOperacao = {
  id: '',
  empresa_id: '',
  nome: '',
  natureza: 'VENDA DE MERCADORIA',
  tipo_operacao: 'saida',
  finalidade: 'normal',
  cfop_padrao: '5102',
  consumidor_final: true,
  indicador_presenca: 9,
  modalidade_frete: 9,
  informacoes_adicionais: '',
  ativo: true,
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '')
}

export default function Fiscal() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [naturezas, setNaturezas] = useState<NaturezaOperacao[]>([])
  const [empresaId, setEmpresaId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<NaturezaOperacao>(emptyNatureza)

  const empresaAtual = useMemo(() => empresas.find((empresa) => empresa.id === empresaId), [empresas, empresaId])

  useEffect(() => {
    loadInitial()
  }, [])

  useEffect(() => {
    if (empresaId) loadNaturezas(empresaId)
  }, [empresaId])

  async function loadInitial() {
    setLoading(true)
    try {
      const empresasData = await apiGet<Empresa[]>('/admin/empresas')
      setEmpresas(empresasData)
      setEmpresaId(empresasData[0]?.id || '')
      if (!empresasData[0]) setNaturezas([])
    } catch (err) {
      toast.error('Erro ao carregar empresas', { description: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }

  async function loadNaturezas(id = empresaId) {
    if (!id) return
    setLoading(true)
    try {
      setNaturezas(await apiGet<NaturezaOperacao[]>(`/admin/naturezas-operacao?empresa_id=${id}`))
    } catch (err) {
      toast.error('Erro ao buscar naturezas', { description: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }

  function novaNatureza() {
    setForm({ ...emptyNatureza, empresa_id: empresaId })
    setShowModal(true)
  }

  function editarNatureza(natureza: NaturezaOperacao) {
    setForm({
      ...natureza,
      informacoes_adicionais: natureza.informacoes_adicionais || '',
      cfop_padrao: natureza.cfop_padrao || '',
    })
    setShowModal(true)
  }

  async function salvarNatureza() {
    if (!form.empresa_id || !form.nome.trim() || !form.natureza.trim()) {
      toast.warning('Preencha empresa, nome e natureza')
      return
    }

    setSaving(true)
    try {
      const payload = {
        ...form,
        cfop_padrao: onlyDigits(form.cfop_padrao || '').slice(0, 4) || null,
        indicador_presenca: Number(form.indicador_presenca),
        modalidade_frete: Number(form.modalidade_frete),
      }
      if (form.id) {
        await apiPatch(`/admin/naturezas-operacao/${form.id}`, payload)
      } else {
        await apiPost('/admin/naturezas-operacao', payload)
      }
      toast.success(form.id ? 'Natureza atualizada' : 'Natureza criada')
      setShowModal(false)
      await loadNaturezas(form.empresa_id)
    } catch (err) {
      toast.error('Erro ao salvar natureza', { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  async function excluirNatureza(natureza: NaturezaOperacao) {
    if (!confirm(`Excluir ${natureza.nome}?`)) return
    try {
      await apiDelete(`/admin/naturezas-operacao/${natureza.id}`)
      toast.success('Natureza excluida')
      await loadNaturezas()
    } catch (err) {
      toast.error('Erro ao excluir natureza', { description: (err as Error).message })
    }
  }

  const input = 'w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30'
  const label = 'mb-1 block text-xs font-medium text-muted-dark'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
            <Settings2 size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">Fiscal</h1>
            <p className="text-sm text-muted">{empresaAtual?.nome || 'Cadastros fiscais para emissao de NF-e'}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className={input} value={empresaId} onChange={(event) => setEmpresaId(event.target.value)}>
            {empresas.map((empresa) => (
              <option key={empresa.id} value={empresa.id}>{empresa.nome}</option>
            ))}
          </select>
          <button
            onClick={() => loadNaturezas()}
            className="inline-flex items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm hover:bg-light-secondary"
          >
            <RefreshCw size={14} /> Atualizar
          </button>
          <button
            onClick={novaNatureza}
            disabled={!empresaId}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            <Plus size={14} /> Nova natureza
          </button>
        </div>
      </div>

      <section className="rounded-lg border border-info/20 bg-info-bg p-4 text-sm text-info">
        Cadastre aqui os cenarios fiscais reutilizaveis, como venda dentro do estado, venda interestadual, devolucao ou remessa. A emissao usa esses dados para preencher natureza, CFOP, finalidade, presenca e frete.
      </section>

      <section className="overflow-hidden rounded-lg border border-black/[0.06] bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/[0.06]">
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Nome</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Natureza</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">CFOP</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Finalidade</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Presenca/Frete</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted">Carregando...</td></tr>
            ) : naturezas.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-muted">Nenhuma natureza cadastrada.</td></tr>
            ) : naturezas.map((natureza) => (
              <tr key={natureza.id} className="border-b border-black/[0.04] hover:bg-light-secondary">
                <td className="px-4 py-3">
                  <div className="font-medium text-dark">{natureza.nome}</div>
                  <div className="text-xs text-muted">{natureza.tipo_operacao === 'saida' ? 'Saida' : 'Entrada'}</div>
                </td>
                <td className="px-4 py-3 text-muted-dark">{natureza.natureza}</td>
                <td className="px-4 py-3 font-mono text-xs">{natureza.cfop_padrao || '-'}</td>
                <td className="px-4 py-3 capitalize">{natureza.finalidade}</td>
                <td className="px-4 py-3 text-xs text-muted">
                  Presenca {natureza.indicador_presenca} / Frete {natureza.modalidade_frete}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${natureza.ativo ? 'bg-success-bg text-success' : 'bg-light-secondary text-muted-dark'}`}>
                    {natureza.ativo ? 'Ativa' : 'Inativa'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => editarNatureza(natureza)} className="mr-2 rounded-lg border border-black/[0.08] p-2 hover:bg-white" title="Editar">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={() => excluirNatureza(natureza)} className="rounded-lg border border-error/20 p-2 text-error hover:bg-error/5" title="Excluir">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {showModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={() => !saving && setShowModal(false)}>
          <div className="w-full max-w-3xl rounded-lg bg-white" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-black/[0.06] p-5">
              <h3 className="font-semibold text-dark">{form.id ? 'Editar natureza' : 'Nova natureza'}</h3>
              <button onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            <div className="max-h-[72vh] space-y-4 overflow-y-auto p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className={label}>Empresa</label>
                  <select className={input} value={form.empresa_id} onChange={(event) => setForm((current) => ({ ...current, empresa_id: event.target.value }))}>
                    {empresas.map((empresa) => (
                      <option key={empresa.id} value={empresa.id}>{empresa.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label}>Nome interno</label>
                  <input className={input} value={form.nome} onChange={(event) => setForm((current) => ({ ...current, nome: event.target.value }))} placeholder="Venda dentro do estado" />
                </div>
                <div className="md:col-span-2">
                  <label className={label}>Natureza da operacao</label>
                  <input className={input} value={form.natureza} onChange={(event) => setForm((current) => ({ ...current, natureza: event.target.value.toUpperCase() }))} />
                </div>
                <div>
                  <label className={label}>Tipo</label>
                  <select className={input} value={form.tipo_operacao} onChange={(event) => setForm((current) => ({ ...current, tipo_operacao: event.target.value as NaturezaOperacao['tipo_operacao'] }))}>
                    <option value="saida">Saida</option>
                    <option value="entrada">Entrada</option>
                  </select>
                </div>
                <div>
                  <label className={label}>Finalidade</label>
                  <select className={input} value={form.finalidade} onChange={(event) => setForm((current) => ({ ...current, finalidade: event.target.value as NaturezaOperacao['finalidade'] }))}>
                    <option value="normal">Normal</option>
                    <option value="complementar">Complementar</option>
                    <option value="ajuste">Ajuste</option>
                    <option value="devolucao">Devolucao</option>
                  </select>
                </div>
                <div>
                  <label className={label}>CFOP padrao</label>
                  <input className={input} maxLength={4} value={form.cfop_padrao || ''} onChange={(event) => setForm((current) => ({ ...current, cfop_padrao: onlyDigits(event.target.value).slice(0, 4) }))} />
                </div>
                <div>
                  <label className={label}>Indicador de presenca</label>
                  <select className={input} value={form.indicador_presenca} onChange={(event) => setForm((current) => ({ ...current, indicador_presenca: Number(event.target.value) }))}>
                    <option value={0}>0 - Nao se aplica</option>
                    <option value={1}>1 - Presencial</option>
                    <option value={2}>2 - Internet</option>
                    <option value={3}>3 - Teleatendimento</option>
                    <option value={4}>4 - NFC-e entrega domicilio</option>
                    <option value={5}>5 - Presencial fora estabelecimento</option>
                    <option value={9}>9 - Outros</option>
                  </select>
                </div>
                <div>
                  <label className={label}>Modalidade do frete</label>
                  <select className={input} value={form.modalidade_frete} onChange={(event) => setForm((current) => ({ ...current, modalidade_frete: Number(event.target.value) }))}>
                    <option value={0}>0 - Por conta do emitente</option>
                    <option value={1}>1 - Por conta do destinatario</option>
                    <option value={2}>2 - Por conta de terceiros</option>
                    <option value={3}>3 - Transporte proprio remetente</option>
                    <option value={4}>4 - Transporte proprio destinatario</option>
                    <option value={9}>9 - Sem frete</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-muted-dark">
                  <input type="checkbox" checked={form.consumidor_final} onChange={(event) => setForm((current) => ({ ...current, consumidor_final: event.target.checked }))} />
                  Consumidor final
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-dark">
                  <input type="checkbox" checked={form.ativo} onChange={(event) => setForm((current) => ({ ...current, ativo: event.target.checked }))} />
                  Ativa
                </label>
                <div className="md:col-span-2">
                  <label className={label}>Informacoes adicionais padrao</label>
                  <textarea className={`${input} min-h-24`} value={form.informacoes_adicionais || ''} onChange={(event) => setForm((current) => ({ ...current, informacoes_adicionais: event.target.value }))} />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-black/[0.06] bg-light-secondary/40 p-3">
              <button onClick={() => setShowModal(false)} className="rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm">Cancelar</button>
              <button onClick={salvarNatureza} disabled={saving} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
