# NFe API — Referência

Base URL (produção): `https://nfe.kaysmelo.com.br`

Todas as respostas são JSON (exceto DELETE que é 204).

## Autenticação

Duas formas, dependendo do escopo:

### 1. Cliente consumidor (ex: sistema de ótica)
Usa **API Key** gerada no painel admin.

```
Authorization: Bearer nf_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- Prefixos possíveis: `nf_live_` (produção SEFAZ) ou `nf_test_` (testes/homologação).
- A key nunca é armazenada em plaintext no servidor — guardamos só o SHA-256.

### 2. Admin do SaaS (painel web)
Usa **JWT do Supabase Auth** (projeto próprio da NFe).

```
Authorization: Bearer <supabase_access_token>
```

---

## Endpoints públicos

### `GET /v1/health`
Saúde do serviço. Sem auth.

```json
{
  "status": "ok",
  "environment": "production",
  "nfe": { "ambiente": "homologacao", "uf": "CE" },
  "timestamp": "2026-04-19T12:00:00.000Z"
}
```

---

## Endpoints do cliente (`Authorization: Bearer <api_key>`)

### `GET /v1/certificado`
Retorna o status do certificado da empresa autenticada.

```json
{
  "cnpj": "12345678000100",
  "razaoSocial": "ÓTICA EXEMPLO LTDA",
  "validoAte": "2027-04-19T00:00:00.000Z",
  "serialNumber": "1234abcd...",
  "diasRestantes": 365,
  "status": "valido"
}
```

Status possíveis: `valido`, `vencendo` (< 30 dias), `vencido`.

→ 404 se não cadastrado.

### `POST /v1/certificado`
Upload do PFX (multipart/form-data):
- Campo `pfx`: arquivo .pfx ou .p12
- Campo `senha`: senha do certificado

```bash
curl -X POST https://nfe.kaysmelo.com.br/v1/certificado \
  -H "Authorization: Bearer nf_live_..." \
  -F "pfx=@/path/to/cert.pfx" \
  -F "senha=SENHA_DO_PFX"
```

→ 200: `{ ok: true, certificado: { cnpj, razaoSocial, validoAte, serialNumber } }`
→ 400: `{ error: "Senha incorreta..." }`

### `DELETE /v1/certificado`
Remove o certificado.
→ 204.

### `POST /v1/nfe`, `POST /v1/nfce`
Placeholders — retornam 501 até Fase 2 do roadmap.

---

## Endpoints admin (`Authorization: Bearer <jwt>`)

### Empresas

- `GET /admin/empresas` — lista
- `GET /admin/empresas/:id` — detalhe
- `POST /admin/empresas` — cria
- `PATCH /admin/empresas/:id` — atualiza
- `DELETE /admin/empresas/:id` — remove

Payload mínimo pra criar:
```json
{
  "nome": "Ótica Princesa Sobral",
  "razao_social": "ÓTICA PRINCESA LTDA",
  "cnpj": "12345678000100",
  "ie": "06123456-7",
  "regime_tributario": "simples",
  "crt": 1,
  "endereco_logradouro": "Rua X",
  "endereco_numero": "123",
  "endereco_bairro": "Centro",
  "endereco_cidade": "Sobral",
  "endereco_uf": "CE",
  "endereco_cep": "62000000",
  "endereco_codigo_ibge": "2312908",
  "ambiente_sefaz": 2,
  "uf_sefaz": "CE"
}
```

### API Keys

- `GET /admin/empresas/:id/api-keys` — lista
- `POST /admin/empresas/:id/api-keys` — cria
  ```json
  { "nome": "Produção Sobral", "env": "live" }
  ```
  Retorna plaintext **UMA VEZ** — guarde imediatamente.
- `DELETE /admin/api-keys/:id` — revoga (soft delete, `revogada_em` preenchido)

### Certificado (via admin)

- `GET /admin/empresas/:id/certificado`
- `POST /admin/empresas/:id/certificado` (multipart: pfx + senha)
- `DELETE /admin/empresas/:id/certificado`

### Naturezas de operacao

- `GET /admin/naturezas-operacao?empresa_id=<uuid>`
- `POST /admin/naturezas-operacao`
- `PATCH /admin/naturezas-operacao/:id`
- `DELETE /admin/naturezas-operacao/:id`

```json
{
  "empresa_id": "uuid-da-empresa",
  "nome": "Venda dentro do estado",
  "natureza": "VENDA DE MERCADORIA",
  "tipo_operacao": "saida",
  "finalidade": "normal",
  "cfop_padrao": "5102",
  "consumidor_final": true,
  "indicador_presenca": 9,
  "modalidade_frete": 9,
  "informacoes_adicionais": "Operacao em homologacao"
}
```

### DARF comum

- `POST /admin/darfs/gerar` gera um PDF preenchido com os campos do DARF comum.

```json
{
  "empresa_id": "uuid-da-empresa",
  "nome_telefone": "EMPRESA LTDA / (00) 0000-0000",
  "periodo_apuracao": "30/04/2026",
  "codigo_receita": "0000",
  "numero_referencia": "",
  "data_vencimento": "20/05/2026",
  "valor_principal": 100,
  "valor_multa": 0,
  "valor_juros": 0
}
```

Resposta: `application/pdf`. Para DARF numerado com codigo de barras/PIX, use o servico oficial da Receita/SicalcWeb.

---

## Códigos de erro

| HTTP | Quando |
|------|--------|
| 400 | Payload inválido, senha do PFX errada, certificado vencido, NCM mal classificado |
| 401 | Sem Authorization ou token inválido/revogado |
| 403 | API key válida mas sem permissão (futuro) |
| 404 | Recurso não encontrado |
| 500 | Erro no servidor ou SEFAZ |
| 501 | Endpoint ainda não implementado |

## Segurança

- PFX armazenado em bucket privado do Supabase Storage
- Senha do PFX cifrada AES-256-GCM (chave só em env var do backend)
- API keys: só SHA-256 no banco, plaintext só retornado na criação
- Service role key do Supabase nunca sai do backend
