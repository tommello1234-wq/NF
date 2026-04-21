# NFe API — SaaS de emissão de NF-e / NFC-e

Produto independente pra emissão de documentos fiscais eletrônicos (NF-e, NFC-e, CF-e SAT) consumido via HTTP por sistemas clientes (como o ERP da Ótica Princesa).

## Estrutura

```
nfe-api/
├── api/                  # Backend Fastify (Node 20, TypeScript)
├── admin/                # Painel admin React/Vite (cadastro de empresas, API keys, certificado)
├── supabase/migrations/  # SQL do banco dedicado
├── docs/api.md           # Referência dos endpoints
└── .github/workflows/    # CI/CD (deploy VPS)
```

## Setup local (primeira vez)

### 1. Criar projeto Supabase dedicado

- Novo projeto em [supabase.com/dashboard](https://supabase.com/dashboard)
- Rodar as 4 migrations em ordem:
  - `001_empresas.sql`
  - `002_api_keys.sql`
  - `003_certificados_digitais.sql`
  - `004_notas_fiscais.sql`
- Settings → Auth → criar um usuário (e-mail+senha) pra acessar o admin

### 2. Rodar o backend

```bash
cd api
cp .env.example .env
# preenche SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CERT_ENCRYPTION_KEY
npm install
npm run dev
```

Testa: `curl http://localhost:3001/v1/health`

### 3. Rodar o admin

```bash
cd admin
cp .env.example .env
# preenche VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_URL
npm install
npm run dev
```

Abre: http://localhost:5174

## Deploy (VPS)

### Primeira vez

```bash
# SSH na VPS
ssh root@<ip_vps>
cd /tmp
curl -fsSL https://raw.githubusercontent.com/<seu_user>/nfe-api/main/api/scripts/setup-vps.sh | bash -s -- nfe.seu-dominio.com.br
```

Depois crie `/var/www/nfe-api/.env` com as envs de produção e configure HTTPS:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d nfe.seu-dominio.com.br
```

### Deploy contínuo

Qualquer push em `main` dispara o workflow que:
1. Builda o admin (React) → rsync pra `/var/www/nfe-admin`
2. Builda a api (Fastify) → rsync pra `/var/www/nfe-api`
3. `npm ci --omit=dev` + `pm2 reload`

**Secrets necessários no GitHub:**
- `VPS_HOST`, `VPS_SSH_KEY`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- `ADMIN_API_URL` (ex: `https://nfe.seu-dominio.com.br`)

## Roadmap

- ✅ Fase 1: Separação, upload certificado, gestão de empresas/API keys
- ⏳ Fase 2: NFC-e em homologação (cupom fiscal pra consumidor final)
- ⏳ Fase 3: NF-e venda, devolução, remessa em garantia
- ⏳ Fase 4: Cancelamento, inutilização, carta de correção, contingência
- ⏳ Fase 5: Migração pra produção

## Integração com sistemas clientes

Exemplo em JavaScript:

```js
const res = await fetch('https://nfe.kaysmelo.com.br/v1/nfe', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ ...payload }),
})
const { chave_acesso, protocolo, xml_url, danfe_url } = await res.json()
```

Veja `docs/api.md` pro contrato completo.
