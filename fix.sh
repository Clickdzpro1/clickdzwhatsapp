#!/bin/bash

# ============================================
# ClickDz WhatsApp — VPS Repair Script
# Fixes a broken/partial deployment
# Usage: curl the repo and run: bash fix.sh
# ============================================

APP_DIR="/opt/clickdz"
VPS_IP=$(hostname -I | awk '{print $1}')

echo "=========================================="
echo "  ClickDz WhatsApp — VPS Repair"
echo "  VPS IP: $VPS_IP"
echo "=========================================="

# ─── Step 1: Ensure services are running ──────────────────
echo ""
echo "[1/6] Checking services..."

systemctl start postgresql 2>/dev/null
systemctl start redis-server 2>/dev/null
systemctl start nginx 2>/dev/null

echo -n "  PostgreSQL: "; systemctl is-active postgresql 2>/dev/null || echo "FAILED"
echo -n "  Redis:      "; systemctl is-active redis-server 2>/dev/null || echo "FAILED"
echo -n "  Nginx:      "; systemctl is-active nginx 2>/dev/null || echo "FAILED"

# ─── Step 2: Fix DB password ─────────────────────────────
echo ""
echo "[2/6] Fixing database..."

if [ -f "$APP_DIR/.env" ]; then
  DB_PASS=$(grep DATABASE_URL "$APP_DIR/.env" | sed 's/.*clickdz:\([^@]*\)@.*/\1/')
  if [ -n "$DB_PASS" ]; then
    sudo -u postgres psql -c "ALTER USER clickdz WITH PASSWORD '$DB_PASS';" 2>/dev/null
    sudo -u postgres psql -d clickdz_whatsapp -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";' 2>/dev/null
    sudo -u postgres psql -d clickdz_whatsapp -c 'CREATE EXTENSION IF NOT EXISTS "pgcrypto";' 2>/dev/null
    echo "  DB password synced, extensions created"
  fi
else
  echo "  ERROR: No .env file found at $APP_DIR/.env"
  echo "  Run deploy.sh first for a fresh deployment."
  exit 1
fi

# ─── Step 3: Run migrations ──────────────────────────────
echo ""
echo "[3/6] Running migrations..."
cd "$APP_DIR"
node migrations/run.js 2>&1
node migrations/seed.js 2>&1

# ─── Step 4: Build frontend if missing ───────────────────
echo ""
echo "[4/6] Checking frontend..."
if [ ! -f "$APP_DIR/frontend/dist/index.html" ]; then
  echo "  Frontend not built, building now..."
  cd "$APP_DIR/frontend"
  npm install 2>&1 | tail -2
  npm run build 2>&1 | tail -3
fi

if [ -f "$APP_DIR/frontend/dist/index.html" ]; then
  echo "  Frontend: OK"
else
  echo "  ERROR: Frontend build failed!"
  exit 1
fi

# ─── Step 5: Configure Nginx ─────────────────────────────
echo ""
echo "[5/6] Configuring Nginx..."

cat > /etc/nginx/sites-available/clickdz << NGINXEOF
upstream clickdz_api {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 80;
    server_name $VPS_IP _;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    root $APP_DIR/frontend/dist;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://clickdz_api;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120;
        proxy_connect_timeout 10;
    }

    location /ws {
        proxy_pass http://clickdz_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400;
    }

    location ~ /\. {
        deny all;
    }

    client_max_body_size 10M;
}
NGINXEOF

ln -sf /etc/nginx/sites-available/clickdz /etc/nginx/sites-enabled/clickdz
rm -f /etc/nginx/sites-enabled/default

if nginx -t 2>&1; then
  systemctl restart nginx
  echo "  Nginx: configured and restarted"
else
  echo "  ERROR: Nginx config test failed!"
fi

# ─── Step 6: Start app with PM2 ──────────────────────────
echo ""
echo "[6/6] Starting app with PM2..."
cd "$APP_DIR"

cat > ecosystem.config.js << 'PM2EOF'
module.exports = {
  apps: [{
    name: 'clickdz-whatsapp',
    script: 'src/server.js',
    cwd: '/opt/clickdz',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
    },
    max_memory_restart: '500M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: '/opt/clickdz/logs/error.log',
    out_file: '/opt/clickdz/logs/app.log',
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_restarts: 10,
    restart_delay: 5000,
  }]
};
PM2EOF

mkdir -p "$APP_DIR/logs" "$APP_DIR/sessions"

pm2 delete clickdz-whatsapp 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root > /dev/null 2>&1

# ─── Step 7: Firewall ────────────────────────────────────
ufw allow 22/tcp > /dev/null 2>&1
ufw allow 80/tcp > /dev/null 2>&1
ufw allow 443/tcp > /dev/null 2>&1
ufw --force enable > /dev/null 2>&1

# ─── Verify ──────────────────────────────────────────────
echo ""
echo "=========================================="
echo "  Verifying..."
echo "=========================================="
sleep 3

HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health)
FRONTEND=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/)
NGINX_API=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/api/health)

echo "  Backend  (port 3000): HTTP $HEALTH"
echo "  Nginx    (port 80):   HTTP $FRONTEND"
echo "  API via Nginx:        HTTP $NGINX_API"

if [ "$HEALTH" = "200" ] && [ "$FRONTEND" = "200" ] && [ "$NGINX_API" = "200" ]; then
  echo ""
  echo "=========================================="
  echo "  ALL GOOD! Your app is live at:"
  echo "  http://$VPS_IP"
  echo "=========================================="
else
  echo ""
  echo "  Something still wrong. Check logs:"
  echo "  pm2 logs clickdz-whatsapp --lines 20"
  echo "  cat /var/log/nginx/error.log | tail -10"
fi
