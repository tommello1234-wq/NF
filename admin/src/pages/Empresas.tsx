import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Building2, X } from 'lucide-react'
import { toast } from 'sonner'
import { apiGet, apiPost } from '../lib/api'

interface Empresa {
  id: string
  nome: string
  razao_social: string
  cnpj: string
  endereco_uf: string | null
  endereco_cidade: string | null
  regime_tributario: string | null
  ambiente_sefaz: number
  status_fiscal?: string
  ativo: boolean
  created_at: string
}

function formatCNPJ(cnpj: string) {
  if (!cnpj || cnpj.length !== 14) return cnpj
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

export default function Empresas() {
  const [list, setList] = useState<Empresa[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)

  // form state
  const [nome, setNome] = useState('')
  const [razaoSocial, setRazaoSocial] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [ie, setIe] = useState('')
  const [regime, setRegime] = useState<'simples' | 'mei' | 'lucro_presumido' | 'lucro_real'>('simples')
  const [crt, setCrt] = useState(1)
  const [uf, setUf] = useState('CE')
  const [cidade, setCidade] = useState('')
  const [cep, setCep] = useState('')
  const [codigoIbge, setCodigoIbge] = useState('')
  const [logradouro, setLogradouro] = useState('')
  const [numero, setNumero] = useState('')
  const [bairro, setBairro] = useState('')
  const [ambiente, setAmbiente] = useState<1 | 2>(2)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const data = await apiGet<Empresa[]>('/admin/empresas')
      setList(data)
    } catch (err) {
      toast.error('Erro ao buscar empresas', { description: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setNome(''); setRazaoSocial(''); setCnpj(''); setIe('')
    setRegime('simples'); setCrt(1); setUf('CE'); setCidade('')
    setCep(''); setCodigoIbge(''); setLogradouro(''); setNumero('')
    setBairro(''); setAmbiente(2)
  }

  async function handleSave() {
    if (!nome.trim() || !razaoSocial.trim() || !cnpj.trim()) {
      toast.warning('Preencha Nome, Razão Social e CNPJ')
      return
    }
    setSaving(true)
    try {
      await apiPost('/admin/empresas', {
        nome, razao_social: razaoSocial, cnpj: cnpj.replace(/\D/g, ''),
        ie: ie || null, regime_tributario: regime, crt,
        endereco_uf: uf, endereco_cidade: cidade || null, endereco_cep: cep || null,
        endereco_codigo_ibge: codigoIbge || null, endereco_logradouro: logradouro || null,
        endereco_numero: numero || null, endereco_bairro: bairro || null,
        ambiente_sefaz: ambiente, uf_sefaz: uf,
      })
      toast.success('Empresa criada!')
      setShowModal(false)
      resetForm()
      load()
    } catch (err) {
      toast.error('Erro ao criar empresa', { description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const input = 'w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30'
  const label = 'mb-1 block text-xs font-medium text-muted-dark'

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
            <Building2 size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">Empresas</h1>
            <p className="text-sm text-muted">Clientes cadastrados no SaaS NFe</p>
          </div>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-hover"
        >
          <Plus size={16} /> Nova Empresa
        </button>
      </div>

      <div className="rounded-2xl border border-black/[0.06] bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/[0.06]">
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Nome</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">CNPJ</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Cidade/UF</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Regime</th>
              <th className="px-4 py-3 text-left text-[11px] uppercase text-muted">Fiscal</th>
              <th className="px-4 py-3 text-center text-[11px] uppercase text-muted">Ambiente</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted">Carregando...</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-muted">Nenhuma empresa cadastrada.</td></tr>
            ) : list.map((e) => (
              <tr key={e.id} className="border-b border-black/[0.04] hover:bg-light-secondary">
                <td className="px-4 py-3">
                  <div className="font-medium text-dark">{e.nome}</div>
                  <div className="text-xs text-muted">{e.razao_social}</div>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{formatCNPJ(e.cnpj)}</td>
                <td className="px-4 py-3 text-muted-dark">
                  {e.endereco_cidade ? `${e.endereco_cidade}/${e.endereco_uf}` : '—'}
                </td>
                <td className="px-4 py-3 text-muted-dark capitalize">{e.regime_tributario || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    e.status_fiscal === 'pronta_producao' || e.status_fiscal === 'pronta_homologacao'
                      ? 'bg-success-bg text-success'
                      : 'bg-warning-bg text-warning'
                  }`}>
                    {e.status_fiscal || 'incompleta'}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    e.ambiente_sefaz === 1 ? 'bg-error-bg text-error' : 'bg-info-bg text-info'
                  }`}>
                    {e.ambiente_sefaz === 1 ? 'Produção' : 'Homologação'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to={`/empresas/${e.id}`}
                    className="rounded-md border border-black/[0.08] px-3 py-1 text-xs text-dark hover:bg-light-secondary"
                  >
                    Gerenciar
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={() => setShowModal(false)}>
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-black/[0.06] p-5">
              <h3 className="font-semibold text-dark">Nova Empresa</h3>
              <button onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={label}>Nome Fantasia *</label>
                  <input className={input} value={nome} onChange={(e) => setNome(e.target.value)} />
                </div>
                <div>
                  <label className={label}>Razão Social *</label>
                  <input className={input} value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} />
                </div>
                <div>
                  <label className={label}>CNPJ *</label>
                  <input className={input} value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" />
                </div>
                <div>
                  <label className={label}>Inscrição Estadual</label>
                  <input className={input} value={ie} onChange={(e) => setIe(e.target.value)} />
                </div>
                <div>
                  <label className={label}>Regime Tributário</label>
                  <select className={input} value={regime} onChange={(e) => setRegime(e.target.value as typeof regime)}>
                    <option value="simples">Simples Nacional</option>
                    <option value="mei">MEI</option>
                    <option value="lucro_presumido">Lucro Presumido</option>
                    <option value="lucro_real">Lucro Real</option>
                  </select>
                </div>
                <div>
                  <label className={label}>CRT (Cód. Regime Tributário)</label>
                  <select className={input} value={crt} onChange={(e) => setCrt(Number(e.target.value))}>
                    <option value={1}>1 - Simples Nacional</option>
                    <option value={2}>2 - Simples, excesso sublimite</option>
                    <option value={3}>3 - Regime Normal</option>
                    <option value={4}>4 - MEI</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={label}>Logradouro</label>
                  <input className={input} value={logradouro} onChange={(e) => setLogradouro(e.target.value)} />
                </div>
                <div>
                  <label className={label}>Número</label>
                  <input className={input} value={numero} onChange={(e) => setNumero(e.target.value)} />
                </div>
                <div>
                  <label className={label}>Bairro</label>
                  <input className={input} value={bairro} onChange={(e) => setBairro(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div className="col-span-2">
                  <label className={label}>Cidade</label>
                  <input className={input} value={cidade} onChange={(e) => setCidade(e.target.value)} />
                </div>
                <div>
                  <label className={label}>UF</label>
                  <input className={input} value={uf} onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} />
                </div>
                <div>
                  <label className={label}>CEP</label>
                  <input className={input} value={cep} onChange={(e) => setCep(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={label}>Código IBGE Município</label>
                  <input className={input} value={codigoIbge} onChange={(e) => setCodigoIbge(e.target.value)} placeholder="ex: 2312908 (Sobral)" />
                </div>
                <div>
                  <label className={label}>Ambiente SEFAZ</label>
                  <select className={input} value={ambiente} onChange={(e) => setAmbiente(Number(e.target.value) as 1 | 2)}>
                    <option value={2}>2 - Homologação (testes)</option>
                    <option value={1}>1 - Produção</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-black/[0.06] p-3 bg-light-secondary/40">
              <button onClick={() => setShowModal(false)} className="rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm">Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
