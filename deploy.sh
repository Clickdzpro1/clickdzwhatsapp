#!/bin/bash
set -e

# ============================================
# ClickDz WhatsApp — One-Command VPS Deployment
# Run as root on a fresh Hostinger VPS (Ubuntu 22.04/24.04)
# Usage: bash deploy.sh
# ============================================

APP_DIR="/opt/clickdz"
DB_NAME="clickdz_whatsapp"
DB_USER="clickdz"
DB_PASS=$(openssl rand -hex 16)
REDIS_PASS=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
VPS_IP=$(hostname -I | awk '{print $1}')

echo "=========================================="
echo "  ClickDz WhatsApp — Production Deployment"
echo "  VPS IP: $VPS_IP"
echo "=========================================="

# ─── 1. System Updates & Dependencies ────────────────────────
echo "[1/8] Installing system dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git nginx certbot python3-certbot-nginx ufw > /dev/null 2>&1

# ─── 2. Install Node.js 20 ──────────────────────────────────
echo "[2/8] Installing Node.js 20..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null 2>&1
fi
echo "  Node.js $(node -v), npm $(npm -v)"

# Install PM2 globally
npm install -g pm2 > /dev/null 2>&1

# ─── 3. Install PostgreSQL 16 ───────────────────────────────
echo "[3/8] Installing PostgreSQL..."
if ! command -v psql &> /dev/null; then
  sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg
  apt-get update -qq
  apt-get install -y -qq postgresql-16 > /dev/null 2>&1
fi
systemctl enable postgresql
systemctl start postgresql

# Create database and user
sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" 2>/dev/null || true
sudo -u postgres psql -d $DB_NAME -c "GRANT ALL ON SCHEMA public TO $DB_USER;" 2>/dev/null || true
# Create extensions as superuser (required before migration)
sudo -u postgres psql -d $DB_NAME -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";' 2>/dev/null || true
sudo -u postgres psql -d $DB_NAME -c 'CREATE EXTENSION IF NOT EXISTS "pgcrypto";' 2>/dev/null || true
echo "  PostgreSQL ready: $DB_NAME"

# ─── 4. Install Redis ───────────────────────────────────────
echo "[4/8] Installing Redis..."
if ! command -v redis-server &> /dev/null; then
  apt-get install -y -qq redis-server > /dev/null 2>&1
fi
# Set Redis password
sed -i "s/^# requirepass.*/requirepass $REDIS_PASS/" /etc/redis/redis.conf
sed -i "s/^requirepass.*/requirepass $REDIS_PASS/" /etc/redis/redis.conf
systemctl enable redis-server
systemctl restart redis-server
echo "  Redis ready"

# ─── 5. Clone & Setup Application ───────────────────────────
echo "[5/8] Setting up application..."
mkdir -p $APP_DIR
if [ -d "$APP_DIR/.git" ]; then
  cd $APP_DIR
  git pull origin claude/whatsapp-ai-assistant-X39pR || true
else
  # If repo is accessible, clone it. Otherwise copy local files
  if git ls-remote https://github.com/Clickdzpro1/clickdzwhatsapp.git &> /dev/null; then
    git clone -b claude/whatsapp-ai-assistant-X39pR https://github.com/Clickdzpro1/clickdzwhatsapp.git $APP_DIR
    cd $APP_DIR
  else
    # Copy from current directory if running locally
    cp -r "$(dirname "$0")"/* $APP_DIR/ 2>/dev/null || true
    cp -r "$(dirname "$0")"/.* $APP_DIR/ 2>/dev/null || true
    cd $APP_DIR
  fi
fi

# Create .env
cat > $APP_DIR/.env << ENVEOF
# Server
PORT=3000
NODE_ENV=production
JWT_SECRET=$JWT_SECRET
FRONTEND_URL=http://$VPS_IP

# PostgreSQL
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME

# Redis
REDIS_URL=redis://:$REDIS_PASS@localhost:6379

# AI - Gemini (FILL THIS IN)
GEMINI_API_KEY=

# Billing - SlickPay (FILL THIS IN)
SLICKPAY_API_KEY=
SLICKPAY_SECRET=

# Trial budget in USD
TRIAL_BUDGET=5.00
WEEKLY_PRICE=7.00

# WhatsApp Bridge
MAX_BRIDGES_PER_SERVER=50
BRIDGE_RAM_MB=100
ENVEOF

echo "  .env created"

# Install backend dependencies
cd $APP_DIR
npm install --omit=dev 2>&1 | tail -3
echo "  Backend dependencies installed"

# Install frontend dependencies and build
cd $APP_DIR/frontend
npm install 2>&1 | tail -3
npm run build 2>&1 | tail -5
if [ ! -d "$APP_DIR/frontend/dist" ]; then
  echo "  ERROR: Frontend build failed! Check output above."
  exit 1
fi
echo "  Frontend built"

# ─── 6. Run Database Migrations ─────────────────────────────
echo "[6/8] Running database migrations..."
cd $APP_DIR
node migrations/run.js
node migrations/seed.js

# ─── 7. Configure Nginx ─────────────────────────────────────
echo "[7/8] Configuring Nginx..."
cat > /etc/nginx/sites-available/clickdz << NGINXEOF
upstream clickdz_api {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 80;
    server_name $VPS_IP _;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Frontend (React SPA)
    root $APP_DIR/frontend/dist;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # API proxy
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

    # WebSocket proxy
    location /ws {
        proxy_pass http://clickdz_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 86400;
    }

    # Block .env and sensitive files
    location ~ /\. {
        deny all;
    }

    client_max_body_size 10M;
}
NGINXEOF

# Enable site
ln -sf /etc/nginx/sites-available/clickdz /etc/nginx/sites-enabled/clickdz
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl restart nginx
echo "  Nginx configured"

# ─── 8. Setup PM2 & Start App ───────────────────────────────
echo "[8/8] Starting application with PM2..."
cd $APP_DIR

# Create PM2 ecosystem file
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

mkdir -p $APP_DIR/logs $APP_DIR/sessions

# Start with PM2
pm2 delete clickdz-whatsapp 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root > /dev/null 2>&1

# ─── 9. Firewall ────────────────────────────────────────────
echo "Configuring firewall..."
ufw allow 22/tcp > /dev/null 2>&1
ufw allow 80/tcp > /dev/null 2>&1
ufw allow 443/tcp > /dev/null 2>&1
ufw --force enable > /dev/null 2>&1

echo ""
echo "=========================================="
echo "  DEPLOYMENT COMPLETE!"
echo "=========================================="
echo ""
echo "  App URL:    http://$VPS_IP"
echo "  API Health: http://$VPS_IP/api/health"
echo ""
echo "  Admin Login:"
echo "    Email: admin@clickdz.com"
echo "    Pass:  admin123"
echo "    (Change this immediately!)"
echo ""
echo "  IMPORTANT — Fill in your API keys:"
echo "    nano /opt/clickdz/.env"
echo "    → Set GEMINI_API_KEY"
echo "    → Set SLICKPAY_API_KEY & SLICKPAY_SECRET"
echo "    Then: pm2 restart clickdz-whatsapp"
echo ""
echo "  Credentials saved to: /opt/clickdz/.deploy-credentials"
echo "=========================================="

# Save credentials
cat > $APP_DIR/.deploy-credentials << CREDEOF
DB_USER=$DB_USER
DB_PASS=$DB_PASS
REDIS_PASS=$REDIS_PASS
JWT_SECRET=$JWT_SECRET
CREDEOF
chmod 600 $APP_DIR/.deploy-credentials

echo ""
echo "Useful commands:"
echo "  pm2 logs clickdz-whatsapp    # View logs"
echo "  pm2 restart clickdz-whatsapp # Restart app"
echo "  pm2 monit                    # Monitor resources"
echo "  nano /opt/clickdz/.env       # Edit config"
