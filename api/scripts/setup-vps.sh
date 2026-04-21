#!/usr/bin/env bash
# Setup inicial da VPS pro produto NFe (Backend + Admin).
# Rode UMA VEZ na VPS como root ou usuário com sudo:
#   bash setup-vps.sh <dominio_admin>
#
# Exemplo: bash setup-vps.sh nfe.kaysmelo.com.br

set -euo pipefail

DOMINIO="${1:-nfe.kaysmelo.com.br}"

echo "🔧 Setup NFe API"
echo "   Domínio: $DOMINIO"

# ---------------- Node.js 20 ----------------
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q '^v20'; then
  echo "📦 Instalando Node 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "✅ Node: $(node -v)"

# ---------------- PM2 ----------------
if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2
fi
echo "✅ PM2: $(pm2 -v)"

# ---------------- Nginx ----------------
if ! command -v nginx >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y nginx
fi

# ---------------- Diretórios ----------------
sudo mkdir -p /var/www/nfe-api /var/www/nfe-admin /var/log/nfe-api
sudo chown -R "$USER:$USER" /var/www/nfe-api /var/www/nfe-admin /var/log/nfe-api

# ---------------- Nginx config ----------------
NGINX_CONF="/etc/nginx/sites-available/nfe-api"

if [ ! -f "$NGINX_CONF" ]; then
  echo "📝 Criando config Nginx..."
  sudo tee "$NGINX_CONF" > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMINIO;

    # Frontend admin
    root /var/www/nfe-admin;
    index index.html;

    # SPA fallback
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # API backend
    location /v1/ {
        proxy_pass http://127.0.0.1:3001/v1/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 10M;
    }

    location /admin/ {
        proxy_pass http://127.0.0.1:3001/admin/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 10M;
    }
}
EOF
  sudo ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/nfe-api
  sudo nginx -t && sudo systemctl reload nginx
  echo "✅ Nginx configurado (HTTP)"
  echo "ℹ️  Pra HTTPS rode: sudo certbot --nginx -d $DOMINIO"
else
  echo "ℹ️  Nginx config já existe — pulando"
fi

# ---------------- PM2 startup ----------------
pm2 startup systemd -u "$USER" --hp "$HOME" | grep -E '^sudo' | bash || true

echo ""
echo "🎉 Setup concluído!"
echo ""
echo "Próximos passos:"
echo "  1. Crie /var/www/nfe-api/.env com:"
echo "     PORT=3001"
echo "     NODE_ENV=production"
echo "     SUPABASE_URL=..."
echo "     SUPABASE_SERVICE_ROLE_KEY=..."
echo "     CERT_ENCRYPTION_KEY=..."
echo "     NFE_AMBIENTE=2"
echo "     NFE_UF=CE"
echo ""
echo "  2. Depois do primeiro deploy:"
echo "     cd /var/www/nfe-api && pm2 start ecosystem.config.cjs && pm2 save"
echo ""
echo "  3. Ativa HTTPS:"
echo "     sudo apt install -y certbot python3-certbot-nginx"
echo "     sudo certbot --nginx -d $DOMINIO"
