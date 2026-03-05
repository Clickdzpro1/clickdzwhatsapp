#!/bin/bash

# ============================================
# ClickDz WhatsApp — Update Script
# Run on VPS to pull latest changes & redeploy
# Usage: bash /opt/clickdz/update.sh
# ============================================

APP_DIR="/opt/clickdz"
cd $APP_DIR

echo "Pulling latest changes..."
git pull origin claude/whatsapp-ai-assistant-X39pR

echo "Installing dependencies..."
npm install --omit=dev 2>&1 | tail -3

echo "Building frontend..."
cd $APP_DIR/frontend
npm install 2>&1 | tail -3
npm run build 2>&1 | tail -5

echo "Running migrations..."
cd $APP_DIR
node migrations/run.js

echo "Restarting app..."
if pm2 describe clickdz-whatsapp > /dev/null 2>&1; then
  pm2 restart clickdz-whatsapp
else
  echo "  PM2 process not found, running fix.sh..."
  bash "$APP_DIR/fix.sh"
fi

echo "Update complete! App is running."
pm2 status
