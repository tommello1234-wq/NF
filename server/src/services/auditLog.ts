/**
 * Audit log — registro de ações reversíveis.
 *
 * Cada `logAcao` insere uma linha em `audit_log`. O frontend lista, e o user
 * pode clicar "Reverter" → chama `reverterAcao(id)` que executa a operação
 * inversa baseado no `tipo_acao` armazenado.
 *
 * Tudo idempotente / silently-degrades: se a tabela ainda não existe (migration
 * 020 não aplicada), apenas loga warning sem quebrar a operação principal.
 */

import { supabase } from './supabase.js'

export type TipoEntidade = 'produto' | 'cliente'
export type TipoAcao =
  | 'arquivar'
  | 'desarquivar'
  | 'ativar'
  | 'desativar'
  | 'importar_massa'
  | 'criar'
  | 'editar'
  | 'excluir'
  // Ações em lote (mantém ids_afetados em metadata)
  | 'lote_ativar'
  | 'lote_desativar'
  | 'lote_arquivar'
  | 'lote_desarquivar'
  | 'lote_remover'

export interface LogAcaoInput {
  empresaId: string
  entidade: TipoEntidade
  entidadeId?: string | null
  tipoAcao: TipoAcao
  descricao: string
  payloadAntes?: Record<string, unknown> | null
  payloadDepois?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
  reversivel?: boolean
}

/** Registra uma ação no audit_log. Falhas são silenciosas (não bloqueiam a op). */
export async function logAcao(input: LogAcaoInput): Promise<{ id?: string }> {
  try {
    const reversivelDefault = input.tipoAcao !== 'excluir'
    const { data, error } = await supabase
      .from('audit_log')
      .insert({
        empresa_id: input.empresaId,
        entidade: input.entidade,
        entidade_id: input.entidadeId || null,
        tipo_acao: input.tipoAcao,
        descricao: input.descricao,
        payload_antes: input.payloadAntes || null,
        payload_depois: input.payloadDepois || null,
        metadata: input.metadata || null,
        reversivel: input.reversivel ?? reversivelDefault,
      })
      .select('id')
      .maybeSingle()

    if (error) {
      // Migration 020 não aplicada — não bloqueia a operação principal
      if (/Could not find the .* table|relation "audit_log" does not exist/i.test(error.message)) {
        console.warn('[auditLog] audit_log table não existe — pulando log. Aplique migration 020.')
        return {}
      }
      console.warn('[auditLog] falha:', error.message)
      return {}
    }
    return { id: data?.id as string | undefined }
  } catch (e) {
    console.warn('[auditLog] exception:', (e as Error).message)
    return {}
  }
}

/**
 * Reverte uma ação registrada no log.
 *
 * Estratégia por tipo_acao:
 *   • arquivar / desarquivar → flipa o campo arquivado
 *   • ativar / desativar     → flipa o campo ativo
 *   • importar_massa         → arquiva todos os IDs em metadata.ids_afetados
 *   • criar                  → arquiva o registro (não exclui pra preservar FK)
 *   • editar                 → aplica payload_antes
 *   • excluir                → não reversível por padrão
 */
export async function reverterAcao(logId: string): Promise<{
  ok: boolean
  error?: string
  log_reversao_id?: string
}> {
  const { data: log, error: logErr } = await supabase
    .from('audit_log')
    .select('*')
    .eq('id', logId)
    .maybeSingle()
  if (logErr) return { ok: false, error: logErr.message }
  if (!log) return { ok: false, error: 'Registro de log não encontrado' }
  if (log.revertida) return { ok: false, error: 'Esta ação já foi revertida' }
  if (!log.reversivel) return { ok: false, error: 'Esta ação não pode ser revertida' }

  const tabela = log.entidade === 'produto' ? 'produtos' : 'clientes'
  const tipo = log.tipo_acao as TipoAcao
  let descricaoReversao = ''
  let novaAcao: TipoAcao = 'editar'

  try {
    if (tipo === 'arquivar') {
      if (!log.entidade_id) return { ok: false, error: 'Log sem entidade_id' }
      await supabase.from(tabela).update({ arquivado: false }).eq('id', log.entidade_id)
      descricaoReversao = `Desarquivado (reversão de "${log.descricao}")`
      novaAcao = 'desarquivar'
    } else if (tipo === 'desarquivar') {
      if (!log.entidade_id) return { ok: false, error: 'Log sem entidade_id' }
      await supabase.from(tabela).update({ arquivado: true }).eq('id', log.entidade_id)
      descricaoReversao = `Arquivado novamente (reversão de "${log.descricao}")`
      novaAcao = 'arquivar'
    } else if (tipo === 'ativar') {
      if (!log.entidade_id) return { ok: false, error: 'Log sem entidade_id' }
      await supabase.from(tabela).update({ ativo: false }).eq('id', log.entidade_id)
      descricaoReversao = `Desativado (reversão de "${log.descricao}")`
      novaAcao = 'desativar'
    } else if (tipo === 'desativar') {
      if (!log.entidade_id) return { ok: false, error: 'Log sem entidade_id' }
      await supabase.from(tabela).update({ ativo: true }).eq('id', log.entidade_id)
      descricaoReversao = `Ativado (reversão de "${log.descricao}")`
      novaAcao = 'ativar'
    } else if (tipo === 'importar_massa') {
      const ids = (log.metadata as { ids_afetados?: string[] } | null)?.ids_afetados || []
      if (ids.length === 0) return { ok: false, error: 'Log sem IDs afetados — não há o que reverter' }
      // Arquiva todos os criados (preserva FK)
      await supabase.from(tabela).update({ arquivado: true }).in('id', ids)
      descricaoReversao = `Arquivado ${ids.length} registros importados (reversão de "${log.descricao}")`
      novaAcao = 'arquivar'
    } else if (tipo === 'lote_ativar' || tipo === 'lote_desativar' || tipo === 'lote_arquivar' || tipo === 'lote_desarquivar') {
      const ids = (log.metadata as { ids_afetados?: string[] } | null)?.ids_afetados || []
      if (ids.length === 0) return { ok: false, error: 'Log sem IDs afetados — nada a reverter' }
      const update =
        tipo === 'lote_ativar'      ? { ativo: false } :
        tipo === 'lote_desativar'   ? { ativo: true } :
        tipo === 'lote_arquivar'    ? { arquivado: false } :
                                       { arquivado: true } // lote_desarquivar
      const palavras: Record<string, string> = {
        lote_ativar: 'desativados', lote_desativar: 'ativados',
        lote_arquivar: 'restaurados', lote_desarquivar: 'arquivados',
      }
      const { error } = await supabase.from(tabela).update(update).in('id', ids)
      if (error) return { ok: false, error: error.message }
      descricaoReversao = `Reversão em lote: ${ids.length} ${log.entidade}${ids.length > 1 ? 's' : ''} ${palavras[tipo]}`
      novaAcao = tipo === 'lote_ativar' ? 'lote_desativar'
               : tipo === 'lote_desativar' ? 'lote_ativar'
               : tipo === 'lote_arquivar' ? 'lote_desarquivar'
               : 'lote_arquivar'
    } else if (tipo === 'lote_remover') {
      return { ok: false, error: 'Remoção em lote não é reversível — registros foram deletados' }
    } else if (tipo === 'criar') {
      if (!log.entidade_id) return { ok: false, error: 'Log sem entidade_id' }
      await supabase.from(tabela).update({ arquivado: true }).eq('id', log.entidade_id)
      descricaoReversao = `Criação revertida via arquivamento (reversão de "${log.descricao}")`
      novaAcao = 'arquivar'
    } else if (tipo === 'editar' && log.payload_antes) {
      if (!log.entidade_id) return { ok: false, error: 'Log sem entidade_id' }
      // Aplica o snapshot anterior — ignora colunas que não existem mais
      const payload = { ...(log.payload_antes as Record<string, unknown>) }
      delete payload.id // nunca atualiza id
      delete payload.created_at
      const upd = await supabase.from(tabela).update(payload).eq('id', log.entidade_id)
      if (upd.error) return { ok: false, error: upd.error.message }
      descricaoReversao = `Edição revertida (reversão de "${log.descricao}")`
      novaAcao = 'editar'
    } else {
      return { ok: false, error: `Tipo de ação "${tipo}" não suporta reversão automática` }
    }

    // Marca o log original como revertido
    await supabase
      .from('audit_log')
      .update({ revertida: true, revertida_em: new Date().toISOString() })
      .eq('id', logId)

    // Registra a reversão como nova entrada (não reversível pra não cascatear)
    const novoLog = await logAcao({
      empresaId: log.empresa_id,
      entidade: log.entidade,
      entidadeId: log.entidade_id,
      tipoAcao: novaAcao,
      descricao: descricaoReversao,
      reversivel: false,
      metadata: { reverte_log_id: log.id },
    })
    return { ok: true, log_reversao_id: novoLog.id }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
