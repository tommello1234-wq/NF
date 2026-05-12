/**
 * Modal genérico de importação xlsx.
 *
 * Aceita:
 *   - parseRow(row, empresaId) → { payload, problemas } | null
 *   - bulkEndpoint: rota que recebe array de payloads
 *   - bulkKey: nome da chave no body (ex: 'clientes' ou 'produtos')
 *
 * Fluxo:
 *   1. Usuário escolhe arquivo
 *   2. Lemos com xlsx-utils, mostramos preview (5 primeiras linhas + total)
 *   3. Botão "Importar" envia em lotes
 */

import { useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, FileSpreadsheet, StopCircle, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { apiPost } from '../lib/api'
import { parseXlsxFile } from '../lib/xlsx-utils'

interface Props<P> {
  titulo: string
  empresaId: string
  empresaNome: string
  bulkEndpoint: string
  bulkKey: string
  parseRow: (row: Record<string, string>, empresaId: string) => { payload: P; problemas: string[] } | null
  permiteAtualizar?: boolean
  onClose: () => void
  onConcluido: () => void
}

interface PreviewState<P> {
  totalLinhas: number
  validos: P[]
  problemas: Array<{ linha: number; descricao: string }>
  amostra: P[]
  headersDetectados: string[]
}

interface ResultadoServidor {
  total: number
  inseridos: number
  atualizados?: number
  pulados?: number
  falhas: Array<{ linha: number; erro: string }>
}

export default function ImportXlsxModal<P extends Record<string, unknown>>(props: Props<P>) {
  const {
    titulo, empresaId, empresaNome, bulkEndpoint, bulkKey, parseRow,
    permiteAtualizar = true, onClose, onConcluido,
  } = props

  const fileRef = useRef<HTMLInputElement>(null)
  // Controller pra cancelar a sequência de POSTs em andamento
  const abortRef = useRef<AbortController | null>(null)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewState<P> | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [modo, setModo] = useState<'pular' | 'atualizar'>('pular')
  const [resultado, setResultado] = useState<ResultadoServidor | null>(null)
  const [progresso, setProgresso] = useState<{ enviados: number; total: number } | null>(null)
  const [cancelando, setCancelando] = useState(false)

  async function handleFile(f: File) {
    setArquivo(f)
    setResultado(null)
    setCarregando(true)
    try {
      const { headers, rows } = await parseXlsxFile(f)
      const validos: P[] = []
      const problemas: Array<{ linha: number; descricao: string }> = []
      let descartadas = 0
      rows.forEach((row, idx) => {
        const parsed = parseRow(row, empresaId)
        const numeroLinha = idx + 2 // header é linha 1
        if (!parsed) {
          // Pula silenciosamente — só conta. Não polui a lista de "problemas".
          descartadas++
          return
        }
        validos.push(parsed.payload)
        for (const p of parsed.problemas) {
          problemas.push({ linha: numeroLinha, descricao: p })
        }
      })
      if (descartadas > 0) {
        problemas.unshift({
          linha: 0,
          descricao: `${descartadas} linha(s) sem campo obrigatório foram descartadas localmente (não são enviadas ao servidor).`,
        })
      }
      setPreview({
        totalLinhas: rows.length,
        validos,
        problemas,
        amostra: validos.slice(0, 5),
        headersDetectados: headers,
      })
    } catch (e) {
      toast.error('Falha ao ler arquivo', { description: (e as Error).message })
      setArquivo(null)
    } finally {
      setCarregando(false)
    }
  }

  async function importar() {
    if (!preview || preview.validos.length === 0) {
      toast.error('Nada para importar')
      return
    }
    setEnviando(true)
    setCancelando(false)
    setResultado(null)
    setProgresso({ enviados: 0, total: preview.validos.length })

    // AbortController novo por importação — botão Cancelar chama .abort()
    abortRef.current = new AbortController()
    const signal = abortRef.current.signal

    const TAMANHO_LOTE = 2000
    let totalInseridos = 0
    let totalAtualizados = 0
    let totalPulados = 0
    const todasFalhas: Array<{ linha: number; erro: string }> = []
    let cancelado = false

    try {
      for (let i = 0; i < preview.validos.length; i += TAMANHO_LOTE) {
        if (signal.aborted) {
          cancelado = true
          break
        }
        const slice = preview.validos
          .slice(i, i + TAMANHO_LOTE)
          .map((r) => ({ ...r, ativo: true })) as typeof preview.validos
        try {
          const res = await apiPost<ResultadoServidor>(
            bulkEndpoint,
            { [bulkKey]: slice, modo: permiteAtualizar ? modo : undefined },
            { signal },
          )
          totalInseridos += res.inseridos || 0
          totalAtualizados += res.atualizados || 0
          totalPulados += res.pulados || 0
          for (const f of res.falhas || []) {
            todasFalhas.push({ linha: i + (f.linha || 0), erro: f.erro })
          }
          setProgresso({
            enviados: Math.min(i + slice.length, preview.validos.length),
            total: preview.validos.length,
          })
        } catch (err) {
          // AbortError = usuário cancelou. Para o loop sem mostrar erro.
          const e = err as { name?: string; message?: string }
          if (e?.name === 'AbortError' || signal.aborted) {
            cancelado = true
            break
          }
          throw err
        }
      }

      const resultadoFinal: ResultadoServidor = {
        total: preview.validos.length,
        inseridos: totalInseridos,
        atualizados: totalAtualizados,
        pulados: totalPulados,
        falhas: todasFalhas,
      }
      setResultado(resultadoFinal)
      const ok = totalInseridos + totalAtualizados
      if (cancelado) {
        toast.warning(`Importação cancelada — ${ok} registros já importados`, {
          description: `Parado no lote ${Math.ceil((totalInseridos + totalAtualizados + totalPulados) / TAMANHO_LOTE)}.`,
        })
      } else if (ok > 0) {
        toast.success(`${ok} registros importados (${todasFalhas.length} falhas)`)
      } else if (todasFalhas.length > 0) {
        toast.error(`Todos falharam — veja detalhes abaixo`)
      }
    } catch (e) {
      toast.error('Erro na importação', { description: (e as Error).message })
    } finally {
      setEnviando(false)
      setCancelando(false)
      abortRef.current = null
    }
  }

  /** Aborta a sequência de POSTs em andamento. */
  function cancelarImportacao() {
    setCancelando(true)
    abortRef.current?.abort()
  }

  function finalizarEFechar() {
    onConcluido()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
      onClick={() => !enviando && onClose()}
    >
      <div className="w-full max-w-3xl rounded-lg bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/[0.06] p-5">
          <div>
            <h3 className="font-semibold text-dark">{titulo}</h3>
            <p className="text-xs text-muted">Importar para: {empresaNome}</p>
          </div>
          <button onClick={onClose} disabled={enviando}>
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[72vh] space-y-4 overflow-y-auto p-5">
          {!arquivo && (
            <div
              onClick={() => fileRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-black/[0.15] p-10 hover:bg-light-secondary"
            >
              <FileSpreadsheet size={40} className="text-muted" />
              <div className="text-sm font-medium text-dark">Clique para escolher um arquivo .xlsx</div>
              <div className="text-xs text-muted">
                Aceita planilhas exportadas do ssÓtica ou os modelos de importação.
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleFile(f)
                }}
              />
            </div>
          )}

          {arquivo && carregando && (
            <div className="rounded-lg border border-black/[0.06] bg-light-secondary p-6 text-center text-sm text-muted">
              Lendo {arquivo.name}…
            </div>
          )}

          {arquivo && !carregando && preview && (
            <>
              <div className="flex items-center justify-between rounded-lg border border-black/[0.06] bg-light-secondary p-3 text-sm">
                <div>
                  <div className="font-medium text-dark">{arquivo.name}</div>
                  <div className="text-xs text-muted">
                    {preview.totalLinhas} linha(s) · {preview.validos.length} válidas · {preview.problemas.length} avisos
                  </div>
                </div>
                <button
                  onClick={() => {
                    setArquivo(null)
                    setPreview(null)
                    setResultado(null)
                  }}
                  className="rounded border border-black/[0.08] bg-white px-2 py-1 text-xs"
                >
                  Trocar arquivo
                </button>
              </div>

              <div className="rounded-lg border border-black/[0.06] p-3">
                <div className="mb-2 text-xs font-semibold uppercase text-muted">
                  Colunas detectadas ({preview.headersDetectados.length})
                </div>
                <div className="flex flex-wrap gap-1">
                  {preview.headersDetectados.map((h) => (
                    <span
                      key={h}
                      className="rounded bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-700"
                    >
                      {h}
                    </span>
                  ))}
                </div>
              </div>

              {preview.amostra.length > 0 && (
                <div className="rounded-lg border border-black/[0.06]">
                  <div className="border-b border-black/[0.06] bg-light-secondary px-3 py-2 text-xs font-semibold text-muted">
                    Pré-visualização (5 primeiras linhas válidas)
                  </div>
                  <div className="max-h-60 overflow-auto px-3 py-2 text-xs font-mono text-neutral-700">
                    {preview.amostra.map((p, i) => (
                      <div key={i} className="border-b border-black/[0.04] py-1 last:border-0">
                        {JSON.stringify(p)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {preview.problemas.length > 0 && (
                <div className="rounded-lg border border-warning/40 bg-warning-bg/40 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-warning">
                    <AlertCircle size={13} /> {preview.problemas.length} aviso(s)
                  </div>
                  <div className="max-h-32 overflow-auto text-xs text-warning-dark">
                    {preview.problemas.slice(0, 50).map((p, i) => (
                      <div key={i}>
                        Linha {p.linha}: {p.descricao}
                      </div>
                    ))}
                    {preview.problemas.length > 50 && (
                      <div className="italic">… mais {preview.problemas.length - 50}</div>
                    )}
                  </div>
                </div>
              )}

              {permiteAtualizar && (
                <div className="rounded-lg border border-black/[0.06] p-3">
                  <div className="mb-2 text-xs font-semibold uppercase text-muted">
                    Comportamento para duplicados
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="modo-import"
                        checked={modo === 'pular'}
                        onChange={() => setModo('pular')}
                      />
                      Pular se já existe (mesmo CPF/CNPJ na empresa)
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="modo-import"
                        checked={modo === 'atualizar'}
                        onChange={() => setModo('atualizar')}
                      />
                      Atualizar os existentes
                    </label>
                  </div>
                </div>
              )}

              {enviando && progresso && (
                <div className="rounded-lg border border-info/40 bg-info-bg/40 p-3">
                  <div className="mb-1 text-xs font-semibold text-info">
                    Enviando lote… {progresso.enviados} de {progresso.total} (
                    {Math.round((progresso.enviados / progresso.total) * 100)}%)
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-info/15">
                    <div
                      className="h-full bg-info transition-all duration-300"
                      style={{ width: `${(progresso.enviados / progresso.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {resultado && (
                <div className="rounded-lg border border-success/40 bg-success-bg/40 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-success">
                    <CheckCircle2 size={13} /> Importação concluída
                  </div>
                  <div className="text-xs text-success-dark">
                    Total: <strong>{resultado.total}</strong> · Inseridos:{' '}
                    <strong>{resultado.inseridos}</strong>
                    {resultado.atualizados != null && resultado.atualizados > 0 && (
                      <> · Atualizados: <strong>{resultado.atualizados}</strong></>
                    )}
                    {resultado.pulados != null && resultado.pulados > 0 && (
                      <> · Pulados: <strong>{resultado.pulados}</strong></>
                    )}
                    {resultado.falhas?.length > 0 && (
                      <> · Falhas: <strong>{resultado.falhas.length}</strong></>
                    )}
                  </div>
                  {resultado.falhas?.length > 0 && (
                    <div className="mt-2 max-h-32 overflow-auto rounded bg-white p-2 text-xs text-error">
                      {resultado.falhas.slice(0, 20).map((f, i) => (
                        <div key={i}>
                          {f.linha > 0 ? `Linha ${f.linha}: ` : ''}{f.erro}
                        </div>
                      ))}
                      {resultado.falhas.length > 20 && (
                        <div className="italic">… mais {resultado.falhas.length - 20}</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-black/[0.06] bg-light-secondary/40 p-3">
          {resultado ? (
            <button
              onClick={finalizarEFechar}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
            >
              Fechar e atualizar lista
            </button>
          ) : enviando ? (
            // Durante o envio: só mostra o botão Cancelar (que aborta de verdade)
            <button
              onClick={cancelarImportacao}
              disabled={cancelando}
              className="inline-flex items-center gap-2 rounded-lg border border-error/30 bg-error/5 px-4 py-2 text-sm font-semibold text-error hover:bg-error/10 disabled:opacity-50"
            >
              <StopCircle size={14} />
              {cancelando ? 'Cancelando…' : 'Cancelar importação'}
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="rounded-lg border border-black/[0.08] bg-white px-4 py-2 text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={importar}
                disabled={!preview || preview.validos.length === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                <Upload size={14} />
                {preview ? `Importar ${preview.validos.length} registros` : 'Importar'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
