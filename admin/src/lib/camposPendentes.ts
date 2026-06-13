/**
 * Helper que verifica quais campos da empresa ainda estão pendentes pra
 * conseguir emitir uma NF-e/NFC-e. Usado pra marcar inputs com borda
 * vermelha e bloquear o botão "Emitir".
 *
 * Save fica lenient (todo PATCH aceita campos parciais) — esse helper
 * só serve pra alertar e bloquear emissão.
 */

export interface EmpresaCampos {
  razao_social?: string | null
  cnpj?: string | null
  ie?: string | null
  crt?: number | null
  endereco_logradouro?: string | null
  endereco_numero?: string | null
  endereco_bairro?: string | null
  endereco_cidade?: string | null
  endereco_uf?: string | null
  endereco_cep?: string | null
  endereco_codigo_ibge?: string | null
  ambiente_sefaz?: number | null
  csc_id?: string | null
  csc_token?: string | null
  csc_id_homol?: string | null
  csc_token_homol?: string | null
  csc_id_prod?: string | null
  csc_token_prod?: string | null
  status_fiscal?: string | null
  // Flags que controlam quais módulos aparecem na sidebar pra cada workspace.
  // emite_nfse default true (quase todo mundo emite serviço); emite_nfe default
  // false (só ativa pra quem vende mercadoria e tem CSC/SEFAZ configurados).
  emite_nfse?: boolean | null
  emite_nfe?: boolean | null
  // Integrações de pagamento online — independentes do tipo de nota emitida.
  usa_stripe?: boolean | null
  usa_ticto?: boolean | null
}

export interface CampoPendente {
  campo: keyof EmpresaCampos
  label: string
  obrigatorio_para: 'NF-e' | 'NFC-e' | 'ambos'
}

/** Lista os campos da empresa ainda pendentes pra emitir NF-e/NFC-e. */
export function camposPendentes(empresa: EmpresaCampos | null | undefined): CampoPendente[] {
  if (!empresa) return []
  const pendentes: CampoPendente[] = []

  const v = (campo: keyof EmpresaCampos) => {
    const val = empresa[campo]
    return val == null || (typeof val === 'string' && val.trim() === '') || (typeof val === 'number' && val === 0)
  }

  // Obrigatórios pros dois modelos
  if (v('razao_social')) pendentes.push({ campo: 'razao_social', label: 'Razão social', obrigatorio_para: 'ambos' })
  if (v('cnpj')) pendentes.push({ campo: 'cnpj', label: 'CNPJ', obrigatorio_para: 'ambos' })
  if (v('ie')) pendentes.push({ campo: 'ie', label: 'Inscrição Estadual (IE)', obrigatorio_para: 'ambos' })
  if (v('crt')) pendentes.push({ campo: 'crt', label: 'CRT (regime tributário)', obrigatorio_para: 'ambos' })
  if (v('endereco_logradouro')) pendentes.push({ campo: 'endereco_logradouro', label: 'Endereço (logradouro)', obrigatorio_para: 'ambos' })
  if (v('endereco_numero')) pendentes.push({ campo: 'endereco_numero', label: 'Endereço (número)', obrigatorio_para: 'ambos' })
  if (v('endereco_bairro')) pendentes.push({ campo: 'endereco_bairro', label: 'Endereço (bairro)', obrigatorio_para: 'ambos' })
  if (v('endereco_cidade')) pendentes.push({ campo: 'endereco_cidade', label: 'Endereço (cidade)', obrigatorio_para: 'ambos' })
  if (v('endereco_uf')) pendentes.push({ campo: 'endereco_uf', label: 'Endereço (UF)', obrigatorio_para: 'ambos' })
  if (v('endereco_cep')) pendentes.push({ campo: 'endereco_cep', label: 'Endereço (CEP)', obrigatorio_para: 'ambos' })
  if (v('endereco_codigo_ibge')) pendentes.push({ campo: 'endereco_codigo_ibge', label: 'Código IBGE do município', obrigatorio_para: 'ambos' })

  // CSC obrigatório só pra NFC-e — usamos homol como mínimo (você quase sempre testa em homol primeiro)
  const temCscHomol = !v('csc_id_homol') && !v('csc_token_homol')
  const temCscLegado = !v('csc_id') && !v('csc_token')
  if (!temCscHomol && !temCscLegado) {
    pendentes.push({ campo: 'csc_id_homol', label: 'CSC (ID + Token)', obrigatorio_para: 'NFC-e' })
  }

  return pendentes
}

/** True se a empresa pode emitir o modelo informado. */
export function podeEmitir(empresa: EmpresaCampos | null | undefined, modelo: 55 | 65): boolean {
  const pendentes = camposPendentes(empresa)
  if (modelo === 65) return pendentes.length === 0
  // modelo 55: ignora pendentes que são SÓ pra NFC-e
  return pendentes.every((p) => p.obrigatorio_para !== 'ambos' && p.obrigatorio_para !== 'NF-e')
    ? true
    : !pendentes.some((p) => p.obrigatorio_para === 'ambos' || p.obrigatorio_para === 'NF-e')
}

/** Set com os nomes dos campos pendentes — útil pra aplicar classe CSS por campo. */
export function camposPendentesSet(empresa: EmpresaCampos | null | undefined): Set<string> {
  return new Set(camposPendentes(empresa).map((p) => p.campo))
}
