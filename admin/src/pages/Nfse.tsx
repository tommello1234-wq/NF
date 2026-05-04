import { useEffect, useState } from 'react'
import { AlertTriangle, Ban, CheckCircle, Download, FileSignature, Plus, RefreshCw, X, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { apiDownload, apiGet, apiPost } from '../lib/api'

interface Empresa {
  id: string
  nome: string
  razao_social: string
  cnpj: string
  inscricao_municipal: string | null
  municipio_emissor_codigo: string | null
  endereco_codigo_ibge: string | null
  nfse_ambiente: number
}

interface Cliente {
  id: string
  nome: string
  cpf_cnpj: string
  email: string | null
  ativo: boolean
}

interface ServicoCadastrado {
  id: string
  descricao: string
  codigo_lc116: string | null
  codigo_tributario_municipal: string | null
  aliquota_iss: string | number | null
  iss_retido: boolean
  valor_unitario: string | number | null
  ativo: boolean
}

interface Nfse {
  id: string
  empresa_id: string
  status: string
  ambiente_nfse: number | null
  numero_dps: number | null
  serie_dps: number | null
  numero_nfse: string | null
  chave_acesso_nfse: string | null
  destinatario_nome: string | null
  destinatario_cpf_cnpj: string | null
  valor_total: string | number | null
  motivo_rejeicao: string | null
  mensagens_retorno: unknown
  emitida_em: string | null
  created_at: string
  empresas?: { nome: string; razao_social: string; cnpj: string } | null
}

type EmitirResult = {
  notaId: string
  status: 'autorizada' | 'rejeitada' | 'falha_temporaria'
  ambiente: 1 | 2
  idDps: string
  numeroDps: number
  serieDps: number
  chaveAcessoNfse?: string
  numeroNfse?: string
  erros?: Array<{ codigo: string; descricao: string; complemento?: string }>
  rawStatus: number
}

function money(value: unknown) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0))
}

function dateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString('pt-BR') : '-'
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function Nfse() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [servicos, setServicos] = useState<ServicoCadastrado[]>([])
  const [notas, setNotas] = useState<Nfse[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [emitting, setEmitting] = useState(false)

  const [form, setForm] = useState({
    empresa_id: '',
    produto_id: '',
    cliente_id: '',
    valor_servicos: 1,
    descricao: '',
  })

  const [cancelando, setCancelando] = useState(false)
  const [showCancel, setShowCancel] = useState<Nfse | null>(null)
  const [cancelForm, setCancelForm] = useState<{ codigo_motivo: '1' | '2' | '9'; descricao_motivo: string }>({
    codigo_motivo: '1',
    descricao_motivo: '',
  })

  useEffect(() => {
    loadInitial()
  }, [])

  async function loadInitial() {
    try {
      const empresasData = await apiGet<Empresa[]>('/admin/empresas')
      setEmpresas(empresasData)
      if (empresasData[0]) {
        setForm((f) => ({ ...f, empresa_id: empresasData[0].id }))
        await loadCadastros(empresasData[0].id)
      }
      await loadNotas()
    } catch (err) {
      toast.error('Erro ao carregar', { description: (err as Error).message })
    }
  }

  async function loadCadastros(empresaId: string) {
    const [clientesData, servicosData] = await Promise.all([
      apiGet<Cliente[]>(`/admin/clientes?empresa_id=${empresaId}&ativo=true`).catch(() => []),
      apiGet<ServicoCadastrado[]>(`/admin/produtos?empresa_id=${empresaId}&tipo=servico&ativo=true`).catch(() => []),
    ])
    setClientes(clientesData)
    setServicos(servicosData)
  }

  async function loadNotas() {
    setLoading(true)
    try {
      setNotas(await apiGet<Nfse[]>('/admin/nfse'))
    } catch (err) {
      toast.error('Erro ao buscar notas', { description: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }

  function changeEmpresa(empresaId: string) {
    setForm((f) => ({ ...f, empresa_id: empresaId, produto_id: '', cliente_id: '' }))
    if (empresaId) loadCadastros(empresaId)
  }

  function changeProduto(produtoId: string) {
    const servico = servicos.find((s) => s.id === produtoId)
    setForm((f) => ({
      ...f,
      produto_id: produtoId,
      descricao: servico?.descricao || f.descricao,
      valor_servicos: Number(servico?.valor_unitario || f.valor_servicos || 1),
    }))
  }

  async function emitir() {
    if (!form.empresa_id || !form.produto_id || !form.cliente_id) {
      toast.warning('Selecione empresa, serviço e cliente')
      return
    }
    if (Number(form.valor_servicos) <= 0) {
      toast.warning('Valor do serviço precisa ser maior que zero')
      return
    }

    const empresa = empresas.find((e) => e.id === form.empresa_id)
    const ambiente = empresa?.nfse_ambiente === 1 ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO'

    if (
      empresa?.nfse_ambiente === 1 &&
      !confirm(`ATENÇÃO: você está em PRODUÇÃO. A nota gerada terá efeito fiscal real. Confirmar?`)
    ) {
      return
    }

    setEmitting(true)
    try {
      const result = await apiPost<EmitirResult>('/admin/nfse/emitir', {
        empresa_id: form.empresa_id,
        produto_id: form.produto_id,
        cliente_id: form.cliente_id,
        valor_servicos: Number(form.valor_servicos),
        descricao: form.descricao || undefined,
      })

      if (result.status === 'autorizada') {
        toast.success(`NFS-e autorizada (${ambiente})`, {
          description: `NFS-e ${result.numeroNfse || ''} | Chave: ${result.chaveAcessoNfse?.slice(0, 20) || ''}…`,
        })
      } else if (result.status === 'rejeitada') {
        const primeiroErro = result.erros?.[0]
        toast.error('NFS-e rejeitada pelo SEFIN', {
          description: primeiroErro
            ? `[${primeiroErro.codigo}] ${primeiroErro.descricao}${primeiroErro.complemento ? ' — ' + primeiroErro.complemento : ''}`
            : 'Verifique a listagem',
          duration: 12000,
        })
      } else {
        toast.warning('Falha temporária na emissão', {
          description: result.erros?.[0]?.descricao || 'Tentar novamente',
        })
      }
      setShowModal(false)
      await loadNotas()
    } catch (err) {
      toast.error('Erro ao emitir NFS-e', { description: (err as Error).message })
    } finally {
      setEmitting(false)
    }
  }

  function openCancel(nota: Nfse) {
    setCancelForm({ codigo_motivo: '1', descricao_motivo: '' })
    setShowCancel(nota)
  }

  async function confirmarCancelamento() {
    if (!showCancel) return
    if (cancelForm.descricao_motivo.trim().length < 15) {
      toast.warning('A descrição do motivo precisa ter pelo menos 15 caracteres')
      return
    }
    setCancelando(true)
    try {
      const result = await apiPost<{ status: string; erros?: Array<{ codigo: string; descricao: string }> }>(
        `/admin/nfse/${showCancel.id}/cancelar`,
        { codigo_motivo: cancelForm.codigo_motivo, descricao_motivo: cancelForm.descricao_motivo.trim() }
      )
      if (result.status === 'cancelada') {
        toast.success('NFS-e cancelada')
      } else {
        const e = result.erros?.[0]
        toast.error('Cancelamento rejeitado pelo SEFIN', {
          description: e ? `[${e.codigo}] ${e.descricao}` : 'Verifique a listagem',
          duration: 12000,
        })
      }
      setShowCancel(null)
      await loadNotas()
    } catch (err) {
      toast.error('Erro ao cancelar NFS-e', { description: (err as Error).message })
    } finally {
      setCancelando(false)
    }
  }

  async function baixarXml(nota: Nfse, tipo: 'dps' | 'nfse') {
    try {
      const blob = await apiDownload(`/admin/nfse/${nota.id}/xml-${tipo}`)
      const filename = `${tipo}-${nota.chave_acesso_nfse || nota.numero_dps || nota.id}.xml`
      downloadBlob(blob, filename)
    } catch (err) {
      toast.error(`Erro ao baixar XML ${tipo.toUpperCase()}`, { description: (err as Error).message })
    }
  }

  const empresaSelecionada = empresas.find((e) => e.id === form.empresa_id)
  const empresaIncompleta = empresaSelecionada && (
    !empresaSelecionada.inscricao_municipal ||
    !(empresaSelecionada.municipio_emissor_codigo || empresaSelecionada.endereco_codigo_ibge)
  )

  const input = 'w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30'
  const label = 'mb-1 block text-xs font-medium text-muted-dark'

  function statusBadge(nota: Nfse) {
    const s = nota.status
    const ambBadge = nota.ambiente_nfse === 1 ? 'PROD' : 'HOM'
    if (s === 'autorizada') return <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-semibold text-success"><CheckCircle size={11} /> autorizada · {ambBadge}</span>
    if (s === 'rejeitada') return <span className="inline-flex items-center gap-1 rounded-full bg-error/10 px-2 py-0.5 text-[11px] font-semibold text-error"><XCircle size={11} /> rejeitada · {ambBadge}</span>
    if (s === 'transmitindo') return <span className="rounded-full bg-info-bg px-2 py-0.5 text-[11px] font-semibold text-info">transmitindo · {ambBadge}</span>
    if (s === 'falha_temporaria') return <span className="rounded-full bg-warning-bg px-2 py-0.5 text-[11px] font-semibold text-warning">falha temp · {ambBadge}</span>
    return <span className="rounded-full bg-light-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-dark">{s} · {ambBadge}</span>
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
            <FileSignature size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">NFS-e (Padrão Nacional)</h1>
            <p className="text-sm text-muted">Emissão de Nota Fiscal de Serviço pelo Padrão Nacional gov.br/nfse</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={loadNotas}
            className="inline-flex items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm hover:bg-light-secondary"
          >
            <RefreshCw size={14} /> Atualizar
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            <Plus size={14} /> Nova NFS-e
          </button>
        </div>
      </div>

      <section className="overflow-hidden rounded-lg border border-black/[0.06] bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/[0.06]">
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Numero</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Empresa</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Tomador</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Valor</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Status</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Emissao</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted">Carregando…</td></tr>
            ) : notas.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-muted">Nenhuma NFS-e emitida ainda.</td></tr>
            ) : notas.map((nota) => (
              <tr key={nota.id} className="border-b border-black/[0.04] hover:bg-light-secondary">
                <td className="px-4 py-3">
                  <div className="font-semibold text-dark">{nota.numero_nfse || '—'}</div>
                  <div className="text-xs text-muted">DPS {nota.numero_dps || '-'} · série {nota.serie_dps || '-'}</div>
                  {nota.chave_acesso_nfse && (
                    <div className="text-[10px] font-mono text-muted truncate" title={nota.chave_acesso_nfse}>
                      {nota.chave_acesso_nfse.slice(0, 25)}…
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-dark">{nota.empresas?.nome || '-'}</div>
                  <div className="text-xs text-muted">{nota.empresas?.cnpj || '-'}</div>
                </td>
                <td className="px-4 py-3">
                  <div>{nota.destinatario_nome || '-'}</div>
                  <div className="text-xs text-muted">{nota.destinatario_cpf_cnpj || '-'}</div>
                </td>
                <td className="px-4 py-3 font-medium">{money(nota.valor_total)}</td>
                <td className="px-4 py-3">
                  {statusBadge(nota)}
                  {nota.motivo_rejeicao && (
                    <div className="mt-1 max-w-xs truncate text-[10px] text-error" title={nota.motivo_rejeicao}>
                      {nota.motivo_rejeicao}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-muted">{dateTime(nota.emitida_em || nota.created_at)}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => baixarXml(nota, 'dps')}
                    className="mr-2 rounded-lg border border-black/[0.08] px-3 py-1.5 text-xs hover:bg-white"
                    title="Download XML DPS assinado"
                  >
                    DPS
                  </button>
                  <button
                    onClick={() => baixarXml(nota, 'nfse')}
                    disabled={!nota.chave_acesso_nfse}
                    className="mr-2 inline-flex items-center gap-1 rounded-lg border border-black/[0.08] px-3 py-1.5 text-xs hover:bg-white disabled:opacity-40"
                    title="Download XML da NFS-e (resposta SEFIN)"
                  >
                    <Download size={12} /> NFS-e
                  </button>
                  {nota.status === 'autorizada' && (
                    <button
                      onClick={() => openCancel(nota)}
                      className="inline-flex items-center gap-1 rounded-lg border border-error/20 px-3 py-1.5 text-xs text-error hover:bg-error/5"
                      title="Cancelar NFS-e"
                    >
                      <Ban size={12} /> Cancelar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {showCancel && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={() => !cancelando && setShowCancel(null)}>
          <div className="w-full max-w-lg rounded-lg bg-white" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-black/[0.06] p-5">
              <h3 className="font-semibold text-dark">Cancelar NFS-e</h3>
              <button onClick={() => setShowCancel(null)}><X size={18} /></button>
            </div>
            <div className="space-y-4 p-5">
              <div className="rounded-lg border border-warning/30 bg-warning-bg p-3 text-xs text-warning">
                <strong>Atenção:</strong> o cancelamento é definitivo. Após cancelar, será necessário emitir uma NFS-e nova.
                Verifique o prazo de cancelamento da prefeitura de Mucambo (geralmente até o dia 10 do mês seguinte à emissão).
              </div>
              <div className="text-sm">
                <div className="text-xs text-muted">NFS-e</div>
                <div className="font-medium text-dark">
                  {showCancel.numero_nfse || '—'} · {money(showCancel.valor_total)} · {showCancel.destinatario_nome || '-'}
                </div>
                {showCancel.chave_acesso_nfse && (
                  <div className="mt-1 break-all font-mono text-[10px] text-muted">{showCancel.chave_acesso_nfse}</div>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-dark">Motivo (código oficial)</label>
                <select
                  className="w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                  value={cancelForm.codigo_motivo}
                  onChange={(ev) => setCancelForm((f) => ({ ...f, codigo_motivo: ev.target.value as '1' | '2' | '9' }))}
                >
                  <option value="1">1 — Erro na Emissão</option>
                  <option value="2">2 — Serviço não Prestado</option>
                  <option value="9">9 — Outros</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-dark">Descrição do motivo (mín. 15 caracteres)</label>
                <textarea
                  className="h-24 w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                  value={cancelForm.descricao_motivo}
                  onChange={(ev) => setCancelForm((f) => ({ ...f, descricao_motivo: ev.target.value }))}
                  placeholder="Descreva o motivo (15-255 caracteres)"
                  maxLength={255}
                />
                <div className="mt-1 text-[11px] text-muted">{cancelForm.descricao_motivo.length}/255</div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-black/[0.06] bg-light-secondary/40 p-3">
              <button
                onClick={() => setShowCancel(null)}
                className="rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm"
              >
                Voltar
              </button>
              <button
                onClick={confirmarCancelamento}
                disabled={cancelando}
                className="rounded-lg bg-error px-5 py-2 text-sm font-semibold text-white hover:bg-error/90 disabled:opacity-50"
              >
                {cancelando ? 'Cancelando…' : 'Confirmar cancelamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={() => !emitting && setShowModal(false)}>
          <div className="w-full max-w-2xl rounded-lg bg-white" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-black/[0.06] p-5">
              <h3 className="font-semibold text-dark">Nova NFS-e</h3>
              <button onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            <div className="max-h-[72vh] space-y-4 overflow-y-auto p-5">
              <div>
                <label className={label}>Empresa emitente</label>
                <select
                  className={input}
                  value={form.empresa_id}
                  onChange={(ev) => changeEmpresa(ev.target.value)}
                >
                  <option value="">Selecione</option>
                  {empresas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome} — {e.cnpj} ({e.nfse_ambiente === 1 ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO'})
                    </option>
                  ))}
                </select>
                {empresaIncompleta && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-bg p-2 text-xs text-warning">
                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                    <div>
                      Empresa sem <strong>Inscrição Municipal</strong> ou <strong>código IBGE</strong> — preencha em <em>Empresas → Detalhe</em> antes de emitir.
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className={label}>Serviço (catálogo)</label>
                <select
                  className={input}
                  value={form.produto_id}
                  onChange={(ev) => changeProduto(ev.target.value)}
                >
                  <option value="">Selecione</option>
                  {servicos.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.descricao} {s.codigo_lc116 ? `· LC116 ${s.codigo_lc116}` : '· SEM LC116!'}
                    </option>
                  ))}
                </select>
                {form.produto_id && servicos.find((s) => s.id === form.produto_id)?.codigo_lc116 == null && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-bg p-2 text-xs text-warning">
                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                    Serviço sem código LC 116 — confirme com seu contador antes de emitir.
                  </div>
                )}
              </div>

              <div>
                <label className={label}>Tomador (cliente cadastrado)</label>
                <select
                  className={input}
                  value={form.cliente_id}
                  onChange={(ev) => setForm((f) => ({ ...f, cliente_id: ev.target.value }))}
                >
                  <option value="">Selecione</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>{c.nome} — {c.cpf_cnpj}</option>
                  ))}
                </select>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className={label}>Valor do serviço (R$)</label>
                  <input
                    className={input}
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={form.valor_servicos}
                    onChange={(ev) => setForm((f) => ({ ...f, valor_servicos: Number(ev.target.value) }))}
                  />
                </div>
              </div>

              <div>
                <label className={label}>Descrição (opcional — usa do serviço se vazia)</label>
                <textarea
                  className={input + ' h-20'}
                  value={form.descricao}
                  onChange={(ev) => setForm((f) => ({ ...f, descricao: ev.target.value }))}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-black/[0.06] bg-light-secondary/40 p-3">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={emitir}
                disabled={emitting}
                className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {emitting ? 'Emitindo…' : 'Emitir NFS-e'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
