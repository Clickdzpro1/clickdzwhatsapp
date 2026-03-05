#!/bin/bash
set -e

# ============================================
# ClickDz WhatsApp — SSL Setup Script
# Run after pointing your domain's DNS to VPS IP
# Usage: bash ssl-setup.sh yourdomain.com
# ============================================

DOMAIN=$1

if [ -z "$DOMAIN" ]; then
  echo "Usage: bash ssl-setup.sh yourdomain.com"
  exit 1
fi

APP_DIR="/opt/clickdz"
VPS_IP=$(hostname -I | awk '{print $1}')

echo "Setting up SSL for $DOMAIN..."

# Update Nginx config with domain
sed -i "s/server_name .*/server_name $DOMAIN;/" /etc/nginx/sites-available/clickdz

# Update .env with domain
sed -i "s|FRONTEND_URL=.*|FRONTEND_URL=https://$DOMAIN|" $APP_DIR/.env

# Restart nginx to apply domain
nginx -t && systemctl restart nginx

# Get SSL certificate
certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN --redirect

# Restart app with new FRONTEND_URL
pm2 restart clickdz-whatsapp

echo ""
echo "SSL configured!"
echo "App now available at: https://$DOMAIN"
echo ""
echo "Certificate auto-renewal is already configured by certbot."
