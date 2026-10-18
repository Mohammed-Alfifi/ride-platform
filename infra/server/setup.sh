#!/usr/bin/env bash
# One-time server setup on Ubuntu 22.04/24.04 (Oracle Cloud, any VPS):
# installs Docker, opens ports 80/443, writes server.env with fresh secrets, and starts everything.
# Usage:  bash setup.sh <api-domain> <admin-domain> <email>
set -euo pipefail
cd "$(dirname "$0")"

API_DOMAIN=${1:?usage: setup.sh <api-domain> <admin-domain> <email>}
ADMIN_DOMAIN=${2:?admin domain missing}
ACME_EMAIL=${3:?email missing}

command -v unzip >/dev/null || sudo apt-get install -y unzip >/dev/null 2>&1 || true

if ! command -v docker >/dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi

# Oracle's Ubuntu images block everything except SSH in iptables; open the web ports.
if sudo iptables -L INPUT -n 2>/dev/null | grep -q REJECT; then
  sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
  sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
  sudo apt-get install -y iptables-persistent >/dev/null 2>&1 || true
  sudo netfilter-persistent save || true
fi

if [ ! -f server.env ]; then
  secret() { openssl rand -base64 "$1" | tr -d '\n'; }
  sed \
    -e "s|^API_DOMAIN=.*|API_DOMAIN=$API_DOMAIN|" \
    -e "s|^ADMIN_DOMAIN=.*|ADMIN_DOMAIN=$ADMIN_DOMAIN|" \
    -e "s|^ACME_EMAIL=.*|ACME_EMAIL=$ACME_EMAIL|" \
    -e "s|^DB_PASSWORD=.*|DB_PASSWORD=$(openssl rand -hex 24)|" \
    -e "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(secret 48)|" \
    -e "s|^HASH_PEPPER=.*|HASH_PEPPER=$(secret 32)|" \
    -e "s|^DATA_ENCRYPTION_KEY=.*|DATA_ENCRYPTION_KEY=$(secret 32)|" \
    server.env.example > server.env
  chmod 600 server.env
  echo "server.env written. Keep a copy somewhere safe: losing DATA_ENCRYPTION_KEY makes stored ID numbers unreadable."
fi

bash fetch-web.sh || true
sudo docker compose --env-file server.env up -d --build
echo
echo "Starting. In a minute or two:"
echo "  API:        https://$API_DOMAIN/health"
echo "  Dashboard:  https://$ADMIN_DOMAIN"
echo "  Join page:  https://$ADMIN_DOMAIN/join   (share it; requests appear in the dashboard)"
echo "  Rider web:  https://$API_DOMAIN/app/"
echo "Fill SUPPORT_WHATSAPP, PAYMENT_INSTRUCTIONS_AR and OPERATOR_NAME in server.env, then: bash update.sh"
echo "Create the first platform admin:  bash admin.sh +9665XXXXXXXX \"Your name\""
