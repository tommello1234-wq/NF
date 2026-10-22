import { gunzipSync } from 'node:zlib'

/**
 * Leitura da resposta da distribuição de DF-e do ADN.
 *
 * Os documentos vêm em GZip+Base64 dentro do JSON. O nome dos campos variou
 * entre versões da API, então em vez de depender deles procuramos qualquer
 * texto que descomprima pra um XML.
 */

export interface DocumentoDistribuido {
  nsu: number | null
  chave: string | null
  tipo: string | null
  numero: string | null
  emitida_em: string | null
  competencia: string | null
  valor: number | null
  emitente_cnpj: string | null
  tomador_doc: string | null
  tomador_nome: string | null
  descricao: string | null
  numero_dps: string | null
  /** Evento (cancelamento etc.), quando o documento é um. */
  evento: string | null
}

function descomprimir(s: string): string | null {
  if (s.length < 40 || !/^[A-Za-z0-9+/=\s]+$/.test(s)) return null
  try {
    const buf = Buffer.from(s, 'base64')
    if (buf[0] !== 0x1f || buf[1] !== 0x8b) return null
    return gunzipSync(buf).toString('utf-8')
  } catch {
    return null
  }
}

function tag(xml: string, nome: string): string | null {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${nome}>([^<]*)</(?:\\w+:)?${nome}>`))
  return m ? m[1].trim() : null
}

function bloco(xml: string, nome: string): string {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${nome}[ >][\\s\\S]*?</(?:\\w+:)?${nome}>`))
  return m ? m[0] : ''
}

export function resumirXml(xml: string): Omit<DocumentoDistribuido, 'nsu' | 'tipo'> {
  const toma = bloco(xml, 'toma')
  const emit = bloco(xml, 'emit')
  const valor = tag(xml, 'vServ') ?? tag(xml, 'vLiq')
  const chave = xml.match(/Id="NFS(\d{50})"/)?.[1] ?? xml.match(/<chNFSe>(\d{50})</)?.[1] ?? null
  return {
    chave,
    numero: tag(xml, 'nNFSe'),
    emitida_em: tag(xml, 'dhProc') ?? tag(xml, 'dhEmi'),
    competencia: tag(xml, 'dCompet'),
    valor: valor ? Number(valor) : null,
    emitente_cnpj: tag(emit, 'CNPJ'),
    tomador_doc: tag(toma, 'CNPJ') ?? tag(toma, 'CPF'),
    tomador_nome: tag(toma, 'xNome'),
    descricao: (tag(xml, 'xDescServ') || '').slice(0, 120) || null,
    numero_dps: tag(xml, 'nDPS'),
    evento: xml.includes('evento') || xml.includes('Evento') ? tag(xml, 'xDesc') ?? tag(xml, 'tpEvento') : null,
  }
}

/** Percorre o JSON e devolve cada item que contém um XML comprimido. */
export function extrairDocumentos(resposta: unknown): DocumentoDistribuido[] {
  const docs: DocumentoDistribuido[] = []
  const visitar = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(visitar)
    if (!v || typeof v !== 'object') return
    const o = v as Record<string, unknown>
    let xml: string | null = null
    for (const val of Object.values(o)) if (typeof val === 'string' && (xml = descomprimir(val))) break
    if (xml) {
      const pegar = (re: RegExp) => Object.entries(o).find(([k]) => re.test(k))?.[1]
      const nsu = Number(pegar(/^nsu$/i))
      docs.push({
        nsu: Number.isFinite(nsu) ? nsu : null,
        tipo: (pegar(/tipo/i) as string) ?? null,
        ...resumirXml(xml),
        chave: (pegar(/chave/i) as string) || resumirXml(xml).chave,
      })
      return
    }
    Object.values(o).forEach(visitar)
  }
  visitar(resposta)
  return docs
}
