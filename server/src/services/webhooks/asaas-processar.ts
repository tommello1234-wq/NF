import { supabase } from '../supabase.js'
import { decryptSecret } from '../crypto-utils.js'
import { cancelarNfse, emitirNfse, type EmitirNfseInput } from '../nfse/orquestrador.js'
import { buscarCliente, buscarParcelamento, listarParcelas } from './asaas-client.js'
import {
  chaveEmissao,
  isEventoCancelar,
  isEventoEmitir,
  type AsaasCustomer,
  type AsaasInstallment,
  type AsaasPayment,
  type AsaasWebhookPayload,
} from './asaas-types.js'

/**
 * Processamento de um pagamento do Asaas — usado pelo webhook e pelo botão
 * "Reprocessar" do painel, pra que os dois sigam exatamente o mesmo caminho.
 *
 * Todo resultado é gravado no próprio webhook_event (status + erro +
 * nota_fiscal_id): é o que o painel mostra, e é a única trilha quando algo
 * falha de madrugada.
 */

export interface ResultadoAsaas {
  ok: boolean
  status: 'processado' | 'erro' | 'ignorado'
  notaId?: string
  notaStatus?: string
  erro?: string
}

async function fecharEvento(eventoId: string, r: ResultadoAsaas): Promise<ResultadoAsaas> {
  await supabase
    .from('webhook_events')
    .update({
      status: r.status,
      erro: r.erro ? r.erro.slice(0, 1000) : null,
      nota_fiscal_id: r.notaId ?? undefined,
      processado_em: new Date().toISOString(),
    })
    .eq('id', eventoId)
  return r
}

function erro(mensagem: string): ResultadoAsaas {
  return { ok: false, status: 'erro', erro: mensagem }
}

async function carregarConfig(empresaId: string): Promise<
  { apiKey: string; produtoId: string } | { falha: string }
> {
  const { data: empresa } = await supabase
    .from('empresas')
    .select('asaas_api_key_cifrado, asaas_produto_default_id')
    .eq('id', empresaId)
    .maybeSingle()
  if (!empresa) return { falha: 'Empresa não encontrada' }
  if (!empresa.asaas_api_key_cifrado) {
    return {
      falha:
        'Chave da API do Asaas não configurada — sem ela não há como buscar CPF/CNPJ e endereço do cliente. Configure em Integração Asaas.',
    }
  }
  if (!empresa.asaas_produto_default_id) {
    return { falha: 'Serviço padrão do Asaas não configurado. Escolha em Integração Asaas.' }
  }
  return {
    apiKey: decryptSecret(empresa.asaas_api_key_cifrado),
    produtoId: empresa.asaas_produto_default_id,
  }
}

/**
 * 'YYYY-MM-DD' do Asaas → Date ao meio-dia de Brasília.
 *
 * `new Date('2026-10-15')` vira 15/10 00:00 UTC, que é 14/10 21:00 aqui — a
 * nota sairia com a competência do dia ANTERIOR (e, no dia 1º, do mês
 * anterior). Meio-dia em -03:00 cai no dia certo em qualquer fuso do Brasil.
 */
export function dataDoAsaas(d: string | null | undefined): Date | undefined {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return undefined
  const data = new Date(`${d.slice(0, 10)}T12:00:00-03:00`)
  if (Number.isNaN(data.getTime())) return undefined
  // Competência no futuro é rejeitada pela SEFIN — nunca passa de agora.
  return data.getTime() > Date.now() ? new Date() : data
}

// ─────────────────────────────────────────────────────────────────────────
// Emissão
// ─────────────────────────────────────────────────────────────────────────

/**
 * Monta a emissão a partir dos dados do Asaas — sem I/O, pra ser testável.
 * É aqui que um erro viraria nota fiscal errada (CPF no lugar de CNPJ, valor
 * da parcela no lugar do total, competência no dia anterior).
 */
export function montarEmissaoAsaas(params: {
  empresaId: string
  produtoId: string
  payment: AsaasPayment
  cliente: AsaasCustomer
  parcelamento?: AsaasInstallment | null
  /** Nota atrasada: a competência é a data da EMISSÃO, não a da venda. */
  competenciaHoje?: boolean
}): { input: EmitirNfseInput } | { falha: string } {
  const { empresaId, produtoId, payment, cliente, parcelamento, competenciaHoje } = params

  const doc = (cliente.cpfCnpj || '').replace(/\D/g, '')
  if (doc.length !== 11 && doc.length !== 14) {
    return {
      falha: `Cliente ${cliente.name || payment.customer} sem CPF/CNPJ válido no Asaas (recebido: "${cliente.cpfCnpj || ''}")`,
    }
  }

  // Valor — parcelamento vira UMA nota pelo total (ver chaveEmissao).
  let valor = Number(payment.value)
  let descricao = payment.description?.trim() || undefined
  if (payment.installment) {
    if (!parcelamento) return { falha: `Parcelamento ${payment.installment} não informado` }
    const total =
      parcelamento.value ??
      (parcelamento.paymentValue != null && parcelamento.installmentCount
        ? parcelamento.paymentValue * parcelamento.installmentCount
        : undefined)
    if (!total || total <= 0) return { falha: `Parcelamento ${payment.installment} sem valor total no Asaas` }
    valor = total
    // A descrição da parcela vem como "Parcela 1 de 12. ..." — a da nota é a da venda.
    descricao = parcelamento.description?.trim() || descricao
  }
  valor = Math.round(valor * 100) / 100
  if (!(valor > 0)) return { falha: `Valor inválido na cobrança ${payment.id}: ${payment.value}` }

  // Endereço — o código IBGE é resolvido pelo CEP dentro do orquestrador
  // (exigência da SEFIN: o município tem que pertencer ao CEP). O Asaas
  // devolve um ID interno de cidade que não serve pra isso.
  const cep = (cliente.postalCode || '').replace(/\D/g, '')
  const endereco =
    cep.length === 8
      ? {
          logradouro: (cliente.address || '').trim(),
          numero: (cliente.addressNumber || '').trim() || 'S/N',
          bairro: (cliente.province || '').trim(),
          cep,
          complemento: cliente.complement?.trim() || undefined,
          codigoMunicipio: '', // preenchido pelo CEP no orquestrador
        }
      : undefined

  return {
    input: {
      empresaId,
      produtoId,
      tomadorOverride: {
        cpf: doc.length === 11 ? doc : undefined,
        cnpj: doc.length === 14 ? doc : undefined,
        nome: (cliente.name || 'Cliente Asaas').trim().slice(0, 150),
        email: cliente.email?.trim() || undefined,
        endereco,
      },
      valorServicos: valor,
      descricao: descricao?.slice(0, 1000),
      // Sem data → o orquestrador usa hoje.
      dataCompetencia: competenciaHoje
        ? undefined
        : dataDoAsaas(payment.confirmedDate || payment.paymentDate || payment.clientPaymentDate),
    },
  }
}

export async function emitirPorPagamentoAsaas(
  eventoId: string,
  empresaId: string,
  payment: AsaasPayment,
  opcoes: { competenciaHoje?: boolean } = {},
): Promise<ResultadoAsaas> {
  const cfg = await carregarConfig(empresaId)
  if ('falha' in cfg) return fecharEvento(eventoId, erro(cfg.falha))

  // O webhook só traz o ID do cliente; o resto vem da API.
  let cliente: AsaasCustomer
  try {
    cliente = await buscarCliente(cfg.apiKey, payment.customer)
  } catch (e) {
    return fecharEvento(eventoId, erro(`Não consegui buscar o cliente ${payment.customer} no Asaas: ${(e as Error).message}`))
  }

  let parcelamento: AsaasInstallment | null = null
  if (payment.installment) {
    try {
      parcelamento = await buscarParcelamento(cfg.apiKey, payment.installment)
    } catch (e) {
      return fecharEvento(eventoId, erro(`Não consegui buscar o parcelamento ${payment.installment}: ${(e as Error).message}`))
    }
  }

  const montado = montarEmissaoAsaas({
    empresaId,
    produtoId: cfg.produtoId,
    payment,
    cliente,
    parcelamento,
    competenciaHoje: opcoes.competenciaHoje,
  })
  if ('falha' in montado) return fecharEvento(eventoId, erro(montado.falha))

  try {
    const result = await emitirNfse(montado.input)
    const autorizada = result.status === 'autorizada'
    return fecharEvento(eventoId, {
      ok: autorizada,
      status: autorizada ? 'processado' : 'erro',
      notaId: result.notaId,
      notaStatus: result.status,
      erro: autorizada ? undefined : result.erros?.map((e) => `[${e.codigo}] ${e.descricao}`).join(' | ') || result.status,
    })
  } catch (e) {
    return fecharEvento(eventoId, erro((e as Error).message))
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Cancelamento por estorno
// ─────────────────────────────────────────────────────────────────────────

export async function cancelarPorEstornoAsaas(
  eventoId: string,
  empresaId: string,
  payment: AsaasPayment,
): Promise<ResultadoAsaas> {
  // A nota foi registrada no evento de emissão, sob a mesma chave.
  const { data: emissao } = await supabase
    .from('webhook_events')
    .select('nota_fiscal_id')
    .eq('provider', 'asaas')
    .eq('external_id', chaveEmissao(payment))
    .not('nota_fiscal_id', 'is', null)
    .maybeSingle()

  if (!emissao?.nota_fiscal_id) {
    return fecharEvento(eventoId, {
      ok: true,
      status: 'ignorado',
      erro:
        'Nenhuma NFS-e emitida por esta integração para essa cobrança. Se houver nota emitida à mão, cancele pela tela de NFS-e.',
    })
  }

  const { data: nota } = await supabase
    .from('notas_fiscais')
    .select('status')
    .eq('id', emissao.nota_fiscal_id)
    .maybeSingle()
  if (nota?.status === 'cancelada') {
    // Parcelamento estornado gera um aviso por parcela; a primeira já cancelou.
    return fecharEvento(eventoId, { ok: true, status: 'processado', notaId: emissao.nota_fiscal_id })
  }
  if (nota?.status !== 'autorizada') {
    return fecharEvento(eventoId, {
      ok: true,
      status: 'ignorado',
      notaId: emissao.nota_fiscal_id,
      erro: `A nota da cobrança não está autorizada (status: ${nota?.status ?? 'desconhecido'}) — nada a cancelar`,
    })
  }

  // Parcelamento: só cancela se TODAS as parcelas foram estornadas. Estornar
  // uma parcela de doze não desfaz a venda, e a nota é do total.
  if (payment.installment) {
    const cfg = await carregarConfig(empresaId)
    if ('falha' in cfg) return fecharEvento(eventoId, erro(cfg.falha))
    try {
      const parcelas = await listarParcelas(cfg.apiKey, payment.installment)
      const pendentes = parcelas.filter((p) => p.status !== 'REFUNDED' && p.id !== payment.id)
      if (pendentes.length > 0) {
        return fecharEvento(
          eventoId,
          erro(
            `Estorno parcial do parcelamento (${parcelas.length - pendentes.length} de ${parcelas.length} parcelas estornadas). A NFS-e é do valor total e NÃO foi cancelada — avalie com o contador se precisa de substituição.`,
          ),
        )
      }
    } catch (e) {
      return fecharEvento(eventoId, erro(`Não consegui conferir as parcelas no Asaas: ${(e as Error).message}`))
    }
  }

  try {
    const result = await cancelarNfse({
      notaId: emissao.nota_fiscal_id,
      codigoMotivo: '9', // Outros
      descricaoMotivo: `Cancelamento automatico: cobranca ${payment.id} estornada no Asaas`,
    })
    const cancelada = result.status === 'cancelada'
    return fecharEvento(eventoId, {
      ok: cancelada,
      status: cancelada ? 'processado' : 'erro',
      notaId: emissao.nota_fiscal_id,
      notaStatus: result.status,
      // Recusa típica: prazo de cancelamento da prefeitura já passou. A nota
      // continua autorizada — o orquestrador não mexe no status quando recusa.
      erro: cancelada
        ? undefined
        : result.erros?.map((e) => `[${e.codigo}] ${e.descricao}`).join(' | ') ||
          // Sem lista de erros (ex.: 500 da SEFIN), o status e o corpo são a única pista.
          `Cancelamento recusado (HTTP ${result.rawStatus}: ${String(result.rawResponse || '').slice(0, 150)})`,
    })
  } catch (e) {
    return fecharEvento(eventoId, erro((e as Error).message))
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Reprocessar (painel)
// ─────────────────────────────────────────────────────────────────────────

export async function reprocessarEventoAsaas(eventoId: string): Promise<ResultadoAsaas> {
  const { data: evento } = await supabase
    .from('webhook_events')
    .select('id, provider, empresa_id, status, payload')
    .eq('id', eventoId)
    .maybeSingle()
  if (!evento) return erro('Evento não encontrado')
  if (evento.provider !== 'asaas') return erro('Esse reprocessamento é só pra eventos do Asaas')
  if (evento.status === 'processado') return erro('Evento já processado — a nota já saiu')
  if (!evento.empresa_id) return erro('Evento sem empresa')

  const payload = evento.payload as unknown as AsaasWebhookPayload
  const payment = payload?.payment
  if (!payment?.id) return erro('Evento sem dados de cobrança')

  await supabase.from('webhook_events').update({ status: 'processando', erro: null }).eq('id', eventoId)

  if (isEventoEmitir(payload.event)) {
    const competenciaHoje = (payload as unknown as { competencia?: string }).competencia === 'hoje'
    return emitirPorPagamentoAsaas(eventoId, evento.empresa_id, payment, { competenciaHoje })
  }
  if (isEventoCancelar(payload.event)) return cancelarPorEstornoAsaas(eventoId, evento.empresa_id, payment)
  return fecharEvento(eventoId, { ok: false, status: 'ignorado', erro: `Evento ${payload.event} não aciona emissão` })
}
