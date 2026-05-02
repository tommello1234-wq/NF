import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CheckCircle,
  ClipboardCheck,
  Clock,
  Copy,
  FileKey,
  Key,
  Save,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from '../lib/api'

interface Empresa {
  id: string
  nome: string
  razao_social: string
  cnpj: string
  ie: string | null
  im: string | null
  regime_tributario: 'simples' | 'mei' | 'lucro_presumido' | 'lucro_real' | null
  crt: number | null
  endereco_logradouro: string | null
  endereco_numero: string | null
  endereco_bairro: string | null
  endereco_cidade: string | null
  endereco_uf: string | null
  endereco_cep: string | null
  endereco_codigo_ibge: string | null
  email: string | null
  telefone: string | null
  ambiente_sefaz: number
  uf_sefaz: string | null
  csc_id: string | null
  csc_token: string | null
  serie_nfe?: number
  proximo_numero_nfe?: number
  serie_nfce?: number
  proximo_numero_nfce?: number
  tipo_emissao_habilitado?: 'teste_local' | 'nfe' | 'nfce' | 'nfe_nfce'
  status_fiscal?: 'incompleta' | 'pronta_homologacao' | 'pronta_producao'
}

interface CertStatus {
  cnpj: string
  razaoSocial: string
  validoAte: string
  serialNumber: string
  diasRestantes: number
  status: 'valido' | 'vencendo' | 'vencido'
}

interface ApiKey {
  id: string
  prefix: string
  nome: string
  ultimo_uso: string | null
  revogada_em: string | null
  created_at: string
}

interface VerificacaoFiscal {
  status: string
  status_fiscal: string
  ambiente: string
  aviso: string
  verificacoes: Array<{
    item: string
    ok: boolean
    mensagem: string
  }>
}

const emptyForm = {
  nome: '',
  razao_social: '',
  cnpj: '',
  ie: '',
  im: '',
  regime_tributario: 'simples',
  crt: 1,
  endereco_logradouro: '',
  endereco_numero: '',
  endereco_bairro: '',
  endereco_cidade: '',
  endereco_uf: 'CE',
  endereco_cep: '',
  endereco_codigo_ibge: '',
  email: '',
  telefone: '',
  ambiente_sefaz: 2,
  uf_sefaz: 'CE',
  csc_id: '',
  csc_token: '',
  serie_nfe: 1,
  proximo_numero_nfe: 1,
  serie_nfce: 1,
  proximo_numero_nfce: 1,
  tipo_emissao_habilitado: 'teste_local',
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '')
}

function formatCNPJ(cnpj: string) {
  const doc = onlyDigits(cnpj)
  if (doc.length !== 14) return cnpj
  return doc.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR')
}

function toForm(empresa: Empresa) {
  return {
    nome: empresa.nome || '',
    razao_social: empresa.razao_social || '',
    cnpj: empresa.cnpj || '',
    ie: empresa.ie || '',
    im: empresa.im || '',
    regime_tributario: empresa.regime_tributario || 'simples',
    crt: empresa.crt || 1,
    endereco_logradouro: empresa.endereco_logradouro || '',
    endereco_numero: empresa.endereco_numero || '',
    endereco_bairro: empresa.endereco_bairro || '',
    endereco_cidade: empresa.endereco_cidade || '',
    endereco_uf: empresa.endereco_uf || 'CE',
    endereco_cep: empresa.endereco_cep || '',
    endereco_codigo_ibge: empresa.endereco_codigo_ibge || '',
    email: empresa.email || '',
    telefone: empresa.telefone || '',
    ambiente_sefaz: empresa.ambiente_sefaz || 2,
    uf_sefaz: empresa.uf_sefaz || empresa.endereco_uf || 'CE',
    csc_id: empresa.csc_id || '',
    csc_token: empresa.csc_token || '',
    serie_nfe: empresa.serie_nfe || 1,
    proximo_numero_nfe: empresa.proximo_numero_nfe || 1,
    serie_nfce: empresa.serie_nfce || 1,
    proximo_numero_nfce: empresa.proximo_numero_nfce || 1,
    tipo_emissao_habilitado: empresa.tipo_emissao_habilitado || 'teste_local',
  }
}

export default function EmpresaDetalhe() {
  const { id } = useParams<{ id: string }>()
  const [empresa, setEmpresa] = useState<Empresa | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [cert, setCert] = useState<CertStatus | null>(null)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [verificacao, setVerificacao] = useState<VerificacaoFiscal | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingEmpresa, setSavingEmpresa] = useState(false)
  const [checking, setChecking] = useState(false)

  const [showUpload, setShowUpload] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [senha, setSenha] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [showNovaKey, setShowNovaKey] = useState(false)
  const [keyNome, setKeyNome] = useState('')
  const [keyEnv, setKeyEnv] = useState<'live' | 'test'>('live')
  const [keyGerada, setKeyGerada] = useState<string | null>(null)
  const [creatingKey, setCreatingKey] = useState(false)

  useEffect(() => {
    if (id) load()
  }, [id])

  async function load() {
    if (!id) return
    setLoading(true)
    try {
      const [emp, certRes, keysRes] = await Promise.all([
        apiGet<Empresa>(`/admin/empresas/${id}`),
        apiGet<CertStatus>(`/admin/empresas/${id}/certificado`).catch(() => null),
        apiGet<ApiKey[]>(`/admin/empresas/${id}/api-keys`),
      ])
      setEmpresa(emp)
      setForm(toForm(emp))
      setCert(certRes)
      setKeys(keysRes)
    } catch (err) {
      toast.error('Erro ao carregar empresa', { description: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }

  async function salvarEmpresa() {
    if (!id) return
    if (!form.nome.trim() || !form.razao_social.trim() || !form.cnpj.trim()) {
      toast.warning('Preencha nome, razao social e CNPJ')
      return
    }

    setSavingEmpresa(true)
    try {
      const payload = {
        ...form,
        cnpj: onlyDigits(form.cnpj),
        endereco_uf: form.endereco_uf.toUpperCase().slice(0, 2),
        uf_sefaz: form.uf_sefaz.toUpperCase().slice(0, 2),
        crt: Number(form.crt),
        ambiente_sefaz: Number(form.ambiente_sefaz),
        serie_nfe: Number(form.serie_nfe),
        proximo_numero_nfe: Number(form.proximo_numero_nfe),
        serie_nfce: Number(form.serie_nfce),
        proximo_numero_nfce: Number(form.proximo_numero_nfce),
      }
      const updated = await apiPatch<Empresa>(`/admin/empresas/${id}`, payload)
      setEmpresa(updated)
      setForm(toForm(updated))
      toast.success('Empresa atualizada')
    } catch (err) {
      toast.error('Erro ao salvar empresa', { description: (err as Error).message })
    } finally {
      setSavingEmpresa(false)
    }
  }

  async function verificarFiscal() {
    if (!id) return
    setChecking(true)
    try {
      const result = await apiPost<VerificacaoFiscal>(`/admin/empresas/${id}/verificar`)
      setVerificacao(result)
      toast.success(result.status === 'pronta' ? 'Configuracao pronta' : 'Pendencias encontradas')
      await load()
    } catch (err) {
      toast.error('Erro ao verificar', { description: (err as Error).message })
    } finally {
      setChecking(false)
    }
  }

  function pickFile(f: File | null) {
    if (!f) return setFile(null)
    const ok = f.name.toLowerCase().endsWith('.pfx') || f.name.toLowerCase().endsWith('.p12')
    if (!ok) return toast.warning('Selecione um .pfx ou .p12')
    if (f.size > 5 * 1024 * 1024) return toast.warning('Arquivo muito grande')
    setFile(f)
  }

  async function uploadCert() {
    if (!id || !file || !senha) {
      toast.warning('Arquivo e senha obrigatorios')
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('pfx', file)
      fd.append('senha', senha)
      await apiUpload(`/admin/empresas/${id}/certificado`, fd)
      toast.success('Certificado cadastrado')
      setShowUpload(false)
      setFile(null)
      setSenha('')
      await load()
    } catch (err) {
      toast.error('Erro ao enviar certificado', { description: (err as Error).message })
    } finally {
      setUploading(false)
    }
  }

  async function removerCert() {
    if (!id || !confirm('Remover certificado desta empresa?')) return
    try {
      await apiDelete(`/admin/empresas/${id}/certificado`)
      toast.success('Certificado removido')
      await load()
    } catch (err) {
      toast.error('Erro ao remover certificado', { description: (err as Error).message })
    }
  }

  async function criarKey() {
    if (!id) return
    if (!keyNome.trim()) return toast.warning('Informe um nome para a chave')
    setCreatingKey(true)
    try {
      const res = await apiPost<{ plaintext: string }>(`/admin/empresas/${id}/api-keys`, { nome: keyNome, env: keyEnv })
      setKeyGerada(res.plaintext)
      setKeyNome('')
      await load()
    } catch (err) {
      toast.error('Erro ao criar chave', { description: (err as Error).message })
    } finally {
      setCreatingKey(false)
    }
  }

  async function revogarKey(keyId: string) {
    if (!confirm('Revogar essa API key?')) return
    try {
      await apiDelete(`/admin/api-keys/${keyId}`)
      toast.success('Chave revogada')
      await load()
    } catch (err) {
      toast.error('Erro ao revogar chave', { description: (err as Error).message })
    }
  }

  if (loading) return <div className="text-muted">Carregando...</div>
  if (!empresa) return <div className="text-error">Empresa nao encontrada</div>

  const input = 'w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30'
  const label = 'mb-1 block text-xs font-medium text-muted-dark'
  const certCfg = cert && {
    valido: { bg: 'bg-success-bg', text: 'text-success', Icon: CheckCircle, label: 'Valido' },
    vencendo: { bg: 'bg-warning-bg', text: 'text-warning', Icon: Clock, label: `Vence em ${cert.diasRestantes} dias` },
    vencido: { bg: 'bg-error-bg', text: 'text-error', Icon: AlertCircle, label: 'Vencido' },
  }[cert.status]

  return (
    <div className="space-y-5">
      <Link to="/empresas" className="inline-flex items-center gap-2 text-sm text-muted hover:text-dark">
        <ArrowLeft size={14} /> Voltar
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
            <Building2 size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">{empresa.nome}</h1>
            <p className="text-sm text-muted">{empresa.razao_social} - {formatCNPJ(empresa.cnpj)}</p>
          </div>
        </div>
        <button onClick={verificarFiscal} disabled={checking} className="inline-flex items-center gap-2 rounded-lg bg-dark px-4 py-2 text-sm font-semibold text-white hover:bg-dark/90 disabled:opacity-50">
          <ClipboardCheck size={15} /> {checking ? 'Verificando...' : 'Verificar fiscal'}
        </button>
      </div>

      <section className="rounded-lg border border-black/[0.06] bg-white p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-dark">Dados e configuracao fiscal</h2>
            <p className="text-xs text-muted">Status: {empresa.status_fiscal || 'incompleta'}</p>
          </div>
          <button onClick={salvarEmpresa} disabled={savingEmpresa} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
            <Save size={14} /> {savingEmpresa ? 'Salvando...' : 'Salvar'}
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className={label}>Nome fantasia</label>
            <input className={input} value={form.nome} onChange={(event) => setForm((current) => ({ ...current, nome: event.target.value }))} />
          </div>
          <div>
            <label className={label}>Razao social</label>
            <input className={input} value={form.razao_social} onChange={(event) => setForm((current) => ({ ...current, razao_social: event.target.value }))} />
          </div>
          <div>
            <label className={label}>CNPJ</label>
            <input className={input} value={form.cnpj} onChange={(event) => setForm((current) => ({ ...current, cnpj: event.target.value }))} />
          </div>
          <div>
            <label className={label}>Inscricao estadual</label>
            <input className={input} value={form.ie} onChange={(event) => setForm((current) => ({ ...current, ie: event.target.value }))} />
          </div>
          <div>
            <label className={label}>Inscricao municipal</label>
            <input className={input} value={form.im} onChange={(event) => setForm((current) => ({ ...current, im: event.target.value }))} />
          </div>
          <div>
            <label className={label}>Regime</label>
            <select className={input} value={form.regime_tributario} onChange={(event) => setForm((current) => ({ ...current, regime_tributario: event.target.value }))}>
              <option value="simples">Simples Nacional</option>
              <option value="mei">MEI</option>
              <option value="lucro_presumido">Lucro Presumido</option>
              <option value="lucro_real">Lucro Real</option>
            </select>
          </div>
          <div>
            <label className={label}>CRT</label>
            <select className={input} value={form.crt} onChange={(event) => setForm((current) => ({ ...current, crt: Number(event.target.value) }))}>
              <option value={1}>1 - Simples</option>
              <option value={2}>2 - Simples excesso</option>
              <option value={3}>3 - Normal</option>
              <option value={4}>4 - MEI</option>
            </select>
          </div>
          <div>
            <label className={label}>Tipo habilitado</label>
            <select className={input} value={form.tipo_emissao_habilitado} onChange={(event) => setForm((current) => ({ ...current, tipo_emissao_habilitado: event.target.value }))}>
              <option value="teste_local">Teste local</option>
              <option value="nfe">NF-e</option>
              <option value="nfce">NFC-e</option>
              <option value="nfe_nfce">NF-e e NFC-e</option>
            </select>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          <div className="md:col-span-2">
            <label className={label}>Logradouro</label>
            <input className={input} value={form.endereco_logradouro} onChange={(event) => setForm((current) => ({ ...current, endereco_logradouro: event.target.value }))} />
          </div>
          <div>
            <label className={label}>Numero</label>
            <input className={input} value={form.endereco_numero} onChange={(event) => setForm((current) => ({ ...current, endereco_numero: event.target.value }))} />
          </div>
          <div>
            <label className={label}>Bairro</label>
            <input className={input} value={form.endereco_bairro} onChange={(event) => setForm((current) => ({ ...current, endereco_bairro: event.target.value }))} />
          </div>
          <div>
            <label className={label}>Cidade</label>
            <input className={input} value={form.endereco_cidade} onChange={(event) => setForm((current) => ({ ...current, endereco_cidade: event.target.value }))} />
          </div>
          <div>
            <label className={label}>UF</label>
            <input className={input} maxLength={2} value={form.endereco_uf} onChange={(event) => setForm((current) => ({ ...current, endereco_uf: event.target.value.toUpperCase().slice(0, 2) }))} />
          </div>
          <div>
            <label className={label}>CEP</label>
            <input className={input} value={form.endereco_cep} onChange={(event) => setForm((current) => ({ ...current, endereco_cep: event.target.value }))} />
          </div>
          <div>
            <label className={label}>Codigo IBGE</label>
            <input className={input} value={form.endereco_codigo_ibge} onChange={(event) => setForm((current) => ({ ...current, endereco_codigo_ibge: event.target.value }))} />
          </div>
          <div>
            <label className={label}>Email</label>
            <input className={input} value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
          </div>
          <div>
            <label className={label}>Telefone</label>
            <input className={input} value={form.telefone} onChange={(event) => setForm((current) => ({ ...current, telefone: event.target.value }))} />
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-4 xl:grid-cols-8">
          <div>
            <label className={label}>Ambiente</label>
            <select className={input} value={form.ambiente_sefaz} onChange={(event) => setForm((current) => ({ ...current, ambiente_sefaz: Number(event.target.value) }))}>
              <option value={2}>Homologacao</option>
              <option value={1}>Producao</option>
            </select>
          </div>
          <div>
            <label className={label}>UF SEFAZ</label>
            <input className={input} maxLength={2} value={form.uf_sefaz} onChange={(event) => setForm((current) => ({ ...current, uf_sefaz: event.target.value.toUpperCase().slice(0, 2) }))} />
          </div>
          <div>
            <label className={label}>Serie NF-e</label>
            <input className={input} type="number" min={1} value={form.serie_nfe} onChange={(event) => setForm((current) => ({ ...current, serie_nfe: Number(event.target.value) }))} />
          </div>
          <div>
            <label className={label}>Prox. NF-e</label>
            <input className={input} type="number" min={1} value={form.proximo_numero_nfe} onChange={(event) => setForm((current) => ({ ...current, proximo_numero_nfe: Number(event.target.value) }))} />
          </div>
          <div>
            <label className={label}>Serie NFC-e</label>
            <input className={input} type="number" min={1} value={form.serie_nfce} onChange={(event) => setForm((current) => ({ ...current, serie_nfce: Number(event.target.value) }))} />
          </div>
          <div>
            <label className={label}>Prox. NFC-e</label>
            <input className={input} type="number" min={1} value={form.proximo_numero_nfce} onChange={(event) => setForm((current) => ({ ...current, proximo_numero_nfce: Number(event.target.value) }))} />
          </div>
          <div>
            <label className={label}>CSC ID</label>
            <input className={input} value={form.csc_id} onChange={(event) => setForm((current) => ({ ...current, csc_id: event.target.value }))} />
          </div>
          <div>
            <label className={label}>CSC Token</label>
            <input className={input} type="password" value={form.csc_token} onChange={(event) => setForm((current) => ({ ...current, csc_token: event.target.value }))} />
          </div>
        </div>
      </section>

      {verificacao && (
        <section className="rounded-lg border border-black/[0.06] bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-dark">Verificacao fiscal</h2>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${verificacao.status === 'pronta' ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning'}`}>
              {verificacao.status}
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {verificacao.verificacoes.map((item) => (
              <div key={item.item} className="rounded-lg border border-black/[0.06] p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-dark">
                  {item.ok ? <CheckCircle size={15} className="text-success" /> : <AlertCircle size={15} className="text-warning" />}
                  {item.item}
                </div>
                <p className="mt-1 text-xs text-muted">{item.mensagem}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-black/[0.06] bg-white">
        <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-accent" />
            <h2 className="font-semibold text-dark">Certificado digital</h2>
          </div>
          {cert ? (
            <div className="flex gap-2">
              <button onClick={() => setShowUpload(true)} className="rounded-lg bg-accent px-4 py-1.5 text-xs text-white hover:bg-accent-hover">Substituir</button>
              <button onClick={removerCert} className="rounded-lg border border-error/30 bg-error/5 px-4 py-1.5 text-xs text-error hover:bg-error/10">Remover</button>
            </div>
          ) : (
            <button onClick={() => setShowUpload(true)} className="inline-flex items-center gap-1 rounded-lg bg-accent px-4 py-1.5 text-xs text-white hover:bg-accent-hover">
              <Upload size={12} /> Cadastrar
            </button>
          )}
        </div>
        {cert && certCfg ? (
          <div className="grid gap-4 p-5 text-sm md:grid-cols-4">
            <div className={`${certCfg.bg} inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${certCfg.text}`}>
              <certCfg.Icon size={14} /> {certCfg.label}
            </div>
            <div><div className="text-xs text-muted">Razao social</div><div className="font-medium">{cert.razaoSocial}</div></div>
            <div><div className="text-xs text-muted">CNPJ</div><div className="font-mono">{formatCNPJ(cert.cnpj)}</div></div>
            <div><div className="text-xs text-muted">Valido ate</div><div className="font-medium">{formatDate(cert.validoAte)}</div></div>
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-muted">Nenhum certificado cadastrado.</div>
        )}
      </section>

      <section className="rounded-lg border border-black/[0.06] bg-white">
        <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-3">
          <div className="flex items-center gap-2">
            <Key size={18} className="text-accent" />
            <h2 className="font-semibold text-dark">API keys</h2>
          </div>
          <button onClick={() => { setShowNovaKey(true); setKeyGerada(null) }} className="rounded-lg bg-accent px-4 py-1.5 text-xs text-white hover:bg-accent-hover">
            Nova chave
          </button>
        </div>
        {keys.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">Nenhuma chave gerada.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/[0.06]">
                <th className="px-4 py-2 text-left text-[11px] uppercase text-muted">Nome</th>
                <th className="px-4 py-2 text-left text-[11px] uppercase text-muted">Prefixo</th>
                <th className="px-4 py-2 text-left text-[11px] uppercase text-muted">Uso</th>
                <th className="px-4 py-2 text-left text-[11px] uppercase text-muted">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} className="border-b border-black/[0.04]">
                  <td className="px-4 py-2">{key.nome}</td>
                  <td className="px-4 py-2 font-mono text-xs">{key.prefix}****</td>
                  <td className="px-4 py-2 text-xs text-muted">{key.ultimo_uso ? formatDate(key.ultimo_uso) : 'nunca'}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${key.revogada_em ? 'bg-error-bg text-error' : 'bg-success-bg text-success'}`}>
                      {key.revogada_em ? 'Revogada' : 'Ativa'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {!key.revogada_em && <button onClick={() => revogarKey(key.id)} className="text-xs text-error hover:underline">Revogar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {showUpload && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={() => !uploading && setShowUpload(false)}>
          <div className="w-full max-w-lg rounded-lg bg-white" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-black/[0.06] p-5">
              <div className="flex items-center gap-2"><FileKey size={18} className="text-accent" /><h3 className="font-semibold">Certificado</h3></div>
              <button onClick={() => setShowUpload(false)}><X size={18} /></button>
            </div>
            <div className="space-y-4 p-5">
              <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full items-center gap-3 rounded-lg border-2 border-dashed border-black/[0.12] bg-light-secondary/40 px-4 py-6 text-left hover:border-accent/40">
                <Upload size={18} className="text-muted" />
                <div>
                  <p className="text-sm font-medium">{file ? file.name : 'Selecionar .pfx ou .p12'}</p>
                  {file && <p className="text-xs text-muted">{(file.size / 1024).toFixed(1)} KB</p>}
                </div>
              </button>
              <input ref={fileRef} type="file" accept=".pfx,.p12" className="hidden" onChange={(event) => pickFile(event.target.files?.[0] || null)} />
              <div>
                <label className={label}>Senha</label>
                <input type="password" value={senha} onChange={(event) => setSenha(event.target.value)} className={input} autoComplete="off" />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-black/[0.06] bg-light-secondary/40 p-3">
              <button onClick={() => setShowUpload(false)} className="rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm">Cancelar</button>
              <button onClick={uploadCert} disabled={uploading || !file || !senha} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
                {uploading ? 'Enviando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNovaKey && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={() => setShowNovaKey(false)}>
          <div className="w-full max-w-lg rounded-lg bg-white" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-black/[0.06] p-5">
              <div className="flex items-center gap-2"><Key size={18} className="text-accent" /><h3 className="font-semibold">{keyGerada ? 'Chave gerada' : 'Nova API key'}</h3></div>
              <button onClick={() => setShowNovaKey(false)}><X size={18} /></button>
            </div>
            {keyGerada ? (
              <div className="space-y-3 p-5">
                <div className="flex gap-2">
                  <code className="flex-1 rounded-lg bg-light-secondary p-3 font-mono text-xs break-all">{keyGerada}</code>
                  <button onClick={() => { navigator.clipboard.writeText(keyGerada); toast.success('Copiado') }} className="rounded-lg bg-accent px-3 text-white hover:bg-accent-hover">
                    <Copy size={14} />
                  </button>
                </div>
                <button onClick={() => setShowNovaKey(false)} className="w-full rounded-lg bg-dark px-4 py-2 text-sm font-semibold text-white">Fechar</button>
              </div>
            ) : (
              <div className="space-y-4 p-5">
                <div>
                  <label className={label}>Nome</label>
                  <input className={input} value={keyNome} onChange={(event) => setKeyNome(event.target.value)} />
                </div>
                <div>
                  <label className={label}>Ambiente</label>
                  <select className={input} value={keyEnv} onChange={(event) => setKeyEnv(event.target.value as 'live' | 'test')}>
                    <option value="live">Producao</option>
                    <option value="test">Teste</option>
                  </select>
                </div>
                <button onClick={criarKey} disabled={creatingKey || !keyNome.trim()} className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
                  {creatingKey ? 'Gerando...' : 'Gerar'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
