#!/bin/bash
set -e

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
npm ci --production > /dev/null 2>&1

echo "Building frontend..."
cd $APP_DIR/frontend
npm install > /dev/null 2>&1
npm run build > /dev/null 2>&1

echo "Running migrations..."
cd $APP_DIR
node migrations/run.js

echo "Restarting app..."
pm2 restart clickdz-whatsapp

echo "Update complete! App is running."
pm2 status
