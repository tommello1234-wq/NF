import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Building2, ShieldCheck, Key, Upload,
  CheckCircle, AlertCircle, Clock, Copy, Plus, FileKey, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { apiGet, apiPost, apiDelete, apiUpload } from '../lib/api'

interface Empresa {
  id: string
  nome: string
  razao_social: string
  cnpj: string
  endereco_cidade: string | null
  endereco_uf: string | null
  regime_tributario: string | null
  ambiente_sefaz: number
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

function formatCNPJ(cnpj: string) {
  if (!cnpj || cnpj.length !== 14) return cnpj
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR')
}

export default function EmpresaDetalhe() {
  const { id } = useParams<{ id: string }>()
  const [empresa, setEmpresa] = useState<Empresa | null>(null)
  const [cert, setCert] = useState<CertStatus | null>(null)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)

  // Upload certificado
  const [showUpload, setShowUpload] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [senha, setSenha] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Nova API key
  const [showNovaKey, setShowNovaKey] = useState(false)
  const [keyNome, setKeyNome] = useState('')
  const [keyEnv, setKeyEnv] = useState<'live' | 'test'>('live')
  const [keyGerada, setKeyGerada] = useState<string | null>(null)
  const [creatingKey, setCreatingKey] = useState(false)

  useEffect(() => {
    if (id) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setCert(certRes)
      setKeys(keysRes)
    } catch (err) {
      toast.error('Erro ao carregar', { description: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }

  function pickFile(f: File | null) {
    if (!f) { setFile(null); return }
    const ok = f.name.toLowerCase().endsWith('.pfx') || f.name.toLowerCase().endsWith('.p12')
    if (!ok) { toast.warning('Selecione um .pfx ou .p12'); return }
    if (f.size > 5 * 1024 * 1024) { toast.warning('Arquivo muito grande (máx 5 MB)'); return }
    setFile(f)
  }

  async function uploadCert() {
    if (!id || !file || !senha) { toast.warning('Arquivo e senha obrigatórios'); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('pfx', file)
      fd.append('senha', senha)
      await apiUpload(`/admin/empresas/${id}/certificado`, fd)
      toast.success('Certificado cadastrado!')
      setShowUpload(false); setFile(null); setSenha('')
      load()
    } catch (err) {
      toast.error('Erro', { description: (err as Error).message })
    } finally {
      setUploading(false)
    }
  }

  async function removerCert() {
    if (!id) return
    if (!confirm('Remover certificado desta empresa?')) return
    try {
      await apiDelete(`/admin/empresas/${id}/certificado`)
      toast.success('Certificado removido')
      load()
    } catch (err) {
      toast.error('Erro', { description: (err as Error).message })
    }
  }

  async function criarKey() {
    if (!id) return
    if (!keyNome.trim()) { toast.warning('Informe um nome para a chave'); return }
    setCreatingKey(true)
    try {
      const res = await apiPost<{ plaintext: string }>(`/admin/empresas/${id}/api-keys`, {
        nome: keyNome, env: keyEnv,
      })
      setKeyGerada(res.plaintext)
      setKeyNome('')
      load()
    } catch (err) {
      toast.error('Erro', { description: (err as Error).message })
    } finally {
      setCreatingKey(false)
    }
  }

  async function revogarKey(keyId: string) {
    if (!confirm('Revogar essa API key? O sistema que usa ela vai parar de funcionar.')) return
    try {
      await apiDelete(`/admin/api-keys/${keyId}`)
      toast.success('Chave revogada')
      load()
    } catch (err) {
      toast.error('Erro', { description: (err as Error).message })
    }
  }

  if (loading) return <div className="text-muted">Carregando...</div>
  if (!empresa) return <div className="text-error">Empresa não encontrada</div>

  const certCfg = cert && {
    valido:   { bg: 'bg-success-bg', text: 'text-success', Icon: CheckCircle, label: 'Válido' },
    vencendo: { bg: 'bg-warning-bg', text: 'text-warning', Icon: Clock,       label: `Vence em ${cert.diasRestantes} dias` },
    vencido:  { bg: 'bg-error-bg',   text: 'text-error',   Icon: AlertCircle, label: 'Vencido' },
  }[cert.status]

  const input = 'w-full rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30'

  return (
    <div className="space-y-5">
      <Link to="/empresas" className="inline-flex items-center gap-2 text-sm text-muted hover:text-dark">
        <ArrowLeft size={14} /> Voltar
      </Link>

      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
          <Building2 size={20} className="text-accent" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-dark">{empresa.nome}</h1>
          <p className="text-sm text-muted">
            {empresa.razao_social} · {formatCNPJ(empresa.cnpj)}
            {empresa.endereco_cidade && ` · ${empresa.endereco_cidade}/${empresa.endereco_uf}`}
          </p>
        </div>
      </div>

      {/* Certificado */}
      <section className="rounded-2xl border border-black/[0.06] bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-accent" />
            <h2 className="font-semibold text-dark">Certificado Digital</h2>
          </div>
          {cert ? (
            <div className="flex gap-2">
              <button onClick={() => setShowUpload(true)} className="rounded-full bg-accent px-4 py-1.5 text-xs text-white hover:bg-accent-hover">Substituir</button>
              <button onClick={removerCert} className="rounded-full border border-error/30 bg-error/5 px-4 py-1.5 text-xs text-error hover:bg-error/10">Remover</button>
            </div>
          ) : (
            <button onClick={() => setShowUpload(true)} className="inline-flex items-center gap-1 rounded-full bg-accent px-4 py-1.5 text-xs text-white hover:bg-accent-hover">
              <Upload size={12} /> Cadastrar
            </button>
          )}
        </div>

        {cert && certCfg ? (
          <div className="p-5 space-y-3">
            <div className={`${certCfg.bg} inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${certCfg.text}`}>
              <certCfg.Icon size={14} /> {certCfg.label}
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><div className="text-xs text-muted">Razão Social</div><div className="font-medium">{cert.razaoSocial}</div></div>
              <div><div className="text-xs text-muted">CNPJ</div><div className="font-mono">{formatCNPJ(cert.cnpj)}</div></div>
              <div><div className="text-xs text-muted">Válido até</div><div className="font-medium">{formatDate(cert.validoAte)}</div></div>
              <div><div className="text-xs text-muted">Serial</div><div className="font-mono text-xs break-all">{cert.serialNumber}</div></div>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-muted text-sm">Nenhum certificado cadastrado.</div>
        )}
      </section>

      {/* API Keys */}
      <section className="rounded-2xl border border-black/[0.06] bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b border-black/[0.06] px-5 py-3">
          <div className="flex items-center gap-2">
            <Key size={18} className="text-accent" />
            <h2 className="font-semibold text-dark">API Keys</h2>
          </div>
          <button onClick={() => { setShowNovaKey(true); setKeyGerada(null) }} className="inline-flex items-center gap-1 rounded-full bg-accent px-4 py-1.5 text-xs text-white hover:bg-accent-hover">
            <Plus size={12} /> Nova chave
          </button>
        </div>

        {keys.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">Nenhuma chave gerada.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/[0.06]">
                <th className="px-4 py-2 text-left text-[11px] uppercase text-muted">Nome</th>
                <th className="px-4 py-2 text-left text-[11px] uppercase text-muted">Prefix</th>
                <th className="px-4 py-2 text-left text-[11px] uppercase text-muted">Último uso</th>
                <th className="px-4 py-2 text-left text-[11px] uppercase text-muted">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-black/[0.04]">
                  <td className="px-4 py-2">{k.nome}</td>
                  <td className="px-4 py-2 font-mono text-xs">{k.prefix}****</td>
                  <td className="px-4 py-2 text-xs text-muted">{k.ultimo_uso ? formatDate(k.ultimo_uso) : 'nunca'}</td>
                  <td className="px-4 py-2">
                    {k.revogada_em ? (
                      <span className="rounded-full bg-error-bg px-2 py-0.5 text-[10px] text-error">Revogada</span>
                    ) : (
                      <span className="rounded-full bg-success-bg px-2 py-0.5 text-[10px] text-success">Ativa</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {!k.revogada_em && (
                      <button onClick={() => revogarKey(k.id)} className="text-xs text-error hover:underline">Revogar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Upload Modal */}
      {showUpload && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={() => !uploading && setShowUpload(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-black/[0.06] p-5">
              <div className="flex items-center gap-2">
                <FileKey size={18} className="text-accent" />
                <h3 className="font-semibold">Cadastrar Certificado</h3>
              </div>
              <button onClick={() => setShowUpload(false)}><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-dark">Arquivo .pfx *</label>
                <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full items-center gap-3 rounded-lg border-2 border-dashed border-black/[0.12] bg-light-secondary/40 px-4 py-6 text-left hover:border-accent/40">
                  <Upload size={18} className="text-muted" />
                  <div>
                    {file ? (<>
                      <p className="text-sm font-medium">{file.name}</p>
                      <p className="text-xs text-muted">{(file.size / 1024).toFixed(1)} KB</p>
                    </>) : (<p className="text-sm text-muted">Clique para selecionar</p>)}
                  </div>
                </button>
                <input ref={fileRef} type="file" accept=".pfx,.p12" className="hidden" onChange={(e) => pickFile(e.target.files?.[0] || null)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-dark">Senha *</label>
                <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} className={input} autoComplete="off" />
                <p className="mt-1 text-[11px] text-muted">🔒 Criptografada com AES-256-GCM antes de salvar.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-black/[0.06] p-3 bg-light-secondary/40">
              <button onClick={() => setShowUpload(false)} className="rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm">Cancelar</button>
              <button onClick={uploadCert} disabled={uploading || !file || !senha} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
                {uploading ? 'Enviando...' : 'Cadastrar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Nova API Key */}
      {showNovaKey && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={() => setShowNovaKey(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-black/[0.06] p-5">
              <div className="flex items-center gap-2">
                <Key size={18} className="text-accent" />
                <h3 className="font-semibold">{keyGerada ? 'Chave Gerada' : 'Nova API Key'}</h3>
              </div>
              <button onClick={() => setShowNovaKey(false)}><X size={18} /></button>
            </div>
            {keyGerada ? (
              <div className="p-5 space-y-3">
                <div className="rounded-lg border border-warning/30 bg-warning-bg p-3 text-xs text-warning-dark">
                  ⚠️ Copie agora. Essa chave <strong>não será exibida de novo</strong>.
                </div>
                <div className="flex gap-2">
                  <code className="flex-1 rounded-lg bg-light-secondary p-3 font-mono text-xs break-all">{keyGerada}</code>
                  <button
                    onClick={() => { navigator.clipboard.writeText(keyGerada); toast.success('Copiado!') }}
                    className="rounded-lg bg-accent px-3 text-white hover:bg-accent-hover"
                  >
                    <Copy size={14} />
                  </button>
                </div>
                <button onClick={() => setShowNovaKey(false)} className="w-full rounded-lg bg-dark px-4 py-2 text-sm font-semibold text-white">Fechar</button>
              </div>
            ) : (
              <div className="p-5 space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-dark">Nome/descrição *</label>
                  <input className={input} value={keyNome} onChange={(e) => setKeyNome(e.target.value)} placeholder="Ex: Produção loja Sobral" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-dark">Ambiente</label>
                  <select className={input} value={keyEnv} onChange={(e) => setKeyEnv(e.target.value as 'live' | 'test')}>
                    <option value="live">nf_live_ — Produção</option>
                    <option value="test">nf_test_ — Testes</option>
                  </select>
                </div>
                <button onClick={criarKey} disabled={creatingKey || !keyNome.trim()} className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
                  {creatingKey ? 'Gerando...' : 'Gerar Chave'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
