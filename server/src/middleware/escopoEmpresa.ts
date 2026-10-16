import type { FastifyRequest } from 'fastify'
import { supabase } from '../services/supabase.js'

/**
 * Isolamento entre empresas no painel.
 *
 * O painel atende empresas de donos diferentes (as óticas e a UPWARD) e cada
 * conta só pode enxergar as empresas a que está vinculada em
 * `usuario_empresas`. Antes desta verificação a separação era só visual: a
 * lista de empresas escondia as outras, mas qualquer rota devolvia os dados de
 * qualquer empresa — a tela de NFS-e, por exemplo, baixava as notas de TODAS
 * (com CPF, nome e valor dos clientes) e só filtrava no navegador.
 *
 * Fechado por padrão: a rota precisa identificar a empresa de algum jeito
 * reconhecido abaixo, senão é recusada. Uma rota nova que esqueça disso
 * quebra de forma visível em vez de vazar em silêncio.
 */

/** Rotas cujo `:id` é de um registro — a empresa sai da própria linha. */
const RECURSO_POR_ROTA: Array<[RegExp, string]> = [
  [/^\/admin\/clientes\/:id(\/|$)/, 'clientes'],
  [/^\/admin\/produtos\/:id(\/|$)/, 'produtos'],
  [/^\/admin\/naturezas-operacao\/:id(\/|$)/, 'naturezas_operacao'],
  [/^\/admin\/(nfe|nfse|notas)\/:id(\/|$)/, 'notas_fiscais'],
  [/^\/admin\/vendas\/:id(\/|$)/, 'vendas'],
  [/^\/admin\/stripe-mapeamento\/:id(\/|$)/, 'stripe_mapeamento'],
  [/^\/admin\/ticto-mapeamento\/:id(\/|$)/, 'ticto_mapeamento'],
  [/^\/admin\/(asaas\/)?webhook-events\/:id(\/|$)/, 'webhook_events'],
  [/^\/admin\/api-keys\/:id(\/|$)/, 'api_keys'],
  [/^\/admin\/audit-log\/:id(\/|$)/, 'audit_log'],
]

/**
 * Listagens que, sem empresa_id, devolviam os registros de TODAS as empresas.
 * Agora a empresa é obrigatória nelas.
 */
const LISTAS_POR_EMPRESA = new Set([
  'GET /admin/clientes',
  'GET /admin/produtos',
  'GET /admin/naturezas-operacao',
  'GET /admin/nfe',
  'GET /admin/nfse',
  'GET /admin/notas',
  'GET /admin/vendas',
  'GET /admin/stripe-mapeamento',
  'GET /admin/ticto-mapeamento',
  'GET /admin/webhook-events',
  'GET /admin/audit-log',
])

/**
 * Rotas que legitimamente não pertencem a uma empresa só. Cada uma cuida do
 * próprio escopo — ver o comentário ao lado.
 */
const SEM_EMPRESA = new Set([
  'GET /admin/empresas', // devolve só as vinculadas (adminEmpresas)
  'POST /admin/empresas', // quem cria é vinculado à empresa criada (adminEmpresas)
  'GET /admin/nfe/preview/:modelo', // DANFE de exemplo, sem dado real
  'POST /admin/clientes/bulk-action', // filtra os ids pelas empresas permitidas
  'POST /admin/produtos/bulk-action', // idem
])

export async function carregarEmpresasPermitidas(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('usuario_empresas')
    .select('empresa_id')
    .eq('user_id', userId)
  // Se a consulta falhar, ninguém ganha acesso por engano.
  if (error) throw new Error(`Falha ao carregar acessos: ${error.message}`)
  return new Set((data || []).map((r) => r.empresa_id as string))
}

/** empresa_id em qualquer lugar do corpo: objeto, lista de objetos, ou lista dentro de objeto. */
function empresasDoCorpo(body: unknown): string[] {
  const achados: string[] = []
  const olhar = (v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const id = (v as Record<string, unknown>).empresa_id
      if (typeof id === 'string' && id) achados.push(id)
    }
  }
  if (Array.isArray(body)) body.forEach(olhar)
  else if (body && typeof body === 'object') {
    olhar(body)
    for (const v of Object.values(body as Record<string, unknown>)) {
      if (Array.isArray(v)) v.forEach(olhar)
    }
  }
  return achados
}

export interface Recusa {
  status: 400 | 403
  error: string
}

/**
 * Confere se a requisição só toca empresas permitidas.
 * @returns null quando pode seguir; a recusa (status + mensagem) quando não.
 */
export async function verificarEscopoEmpresa(
  req: FastifyRequest,
  permitidas: Set<string>,
): Promise<Recusa | null> {
  const rota = req.routeOptions?.url || ''
  const chave = `${req.method} ${rota}`
  const params = (req.params || {}) as Record<string, string | undefined>
  const query = (req.query || {}) as Record<string, string | undefined>

  const empresas: string[] = []
  if (params.empresaId) empresas.push(params.empresaId)
  if (/^\/admin\/empresas\/:id(\/|$)/.test(rota) && params.id) empresas.push(params.id)
  if (typeof query.empresa_id === 'string' && query.empresa_id) empresas.push(query.empresa_id)
  empresas.push(...empresasDoCorpo(req.body))

  // Registro identificado pelo :id → a empresa é a dele.
  const recurso = RECURSO_POR_ROTA.find(([re]) => re.test(rota))
  if (recurso && params.id) {
    const { data, error } = await supabase
      .from(recurso[1])
      .select('empresa_id')
      .eq('id', params.id)
      .maybeSingle()
    if (error) return { status: 403, error: 'Não foi possível conferir o acesso a este registro' }
    // Registro inexistente: deixa a rota responder 404 normalmente. Não há
    // dado de outra empresa a proteger, e um 403 aqui revelaria que o id existe.
    if (data) {
      if (!data.empresa_id) return { status: 403, error: 'Registro sem empresa — acesso negado' }
      empresas.push(data.empresa_id as string)
    }
  } else if (LISTAS_POR_EMPRESA.has(chave) && !query.empresa_id) {
    return { status: 400, error: 'Informe a empresa (empresa_id)' }
  } else if (empresas.length === 0 && !SEM_EMPRESA.has(chave)) {
    return { status: 400, error: 'Requisição sem empresa identificada' }
  }

  const negada = empresas.find((id) => !permitidas.has(id))
  if (negada) return { status: 403, error: 'Sem acesso a esta empresa' }
  return null
}
