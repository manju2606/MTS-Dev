#!/bin/bash
# First-boot bootstrap, templated and injected by Terraform as droplet
# user_data. Installs Docker, clones the app, writes the prod env files with
# generated secrets, waits for DNS to point here, bootstraps a Let's Encrypt
# cert (via a throwaway self-signed cert so nginx can start at all), then
# brings up the full stack. Progress: /var/log/mts-bootstrap.log
set -euo pipefail
exec > >(tee -a /var/log/mts-bootstrap.log) 2>&1

FQDN="${fqdn}"
REPO_URL="${repo_url}"
REPO_BRANCH="${repo_branch}"
LETSENCRYPT_EMAIL="${letsencrypt_email}"
APP_SECRET_KEY="${secret_key}"
POSTGRES_PASSWORD="${postgres_password}"
ANTHROPIC_API_KEY="${anthropic_api_key}"

APP_DIR=/opt/mts

echo "=== mts bootstrap starting $(date -u) ==="

wait_for_apt() {
  while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || fuser /var/lib/apt/lists/lock >/dev/null 2>&1; do
    sleep 3
  done
}

# ── Docker install (official apt repo) ───────────────────────────────────────
wait_for_apt
apt-get update -y
apt-get install -y ca-certificates curl git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
  > /etc/apt/sources.list.d/docker.list
wait_for_apt
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker

# ── Clone the app ─────────────────────────────────────────────────────────────
git clone --branch "$REPO_BRANCH" --depth 1 "$REPO_URL" "$APP_DIR"
cd "$APP_DIR"

# ── Env files ─────────────────────────────────────────────────────────────────
cat > .env <<ENVEOF
COMPOSE_PROJECT_NAME=mts
DOMAIN=$FQDN
POSTGRES_USER=mts
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=mts_prod
ENVEOF

cat > backend/.env.prod <<ENVEOF
SECRET_KEY=$APP_SECRET_KEY
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=480
CORS_ORIGINS=["https://$FQDN"]
ENVIRONMENT=production
DEBUG=false
PAPER_CAPITAL=100000.0
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
POSTGRES_USER=mts
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=mts_prod
ENVEOF

# ── Dummy self-signed cert so nginx's 443 block can start the first time ────
docker volume create mts_certbot_certs >/dev/null
docker run --rm -v mts_certbot_certs:/etc/letsencrypt alpine:3.20 sh -c "
  apk add --no-cache openssl >/dev/null &&
  mkdir -p /etc/letsencrypt/live/$FQDN &&
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout /etc/letsencrypt/live/$FQDN/privkey.pem \
    -out /etc/letsencrypt/live/$FQDN/fullchain.pem \
    -subj '/CN=$FQDN'
"

# ── Bring up the stack ────────────────────────────────────────────────────────
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# ── Wait for DNS to actually point at this droplet before requesting the
#    real cert — the A record is created by the same terraform apply, but
#    public resolvers can lag a couple minutes behind DO's own nameservers.
MY_IP="$(curl -fsS http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address)"
echo "Waiting for $FQDN to resolve to $MY_IP ..."
for i in $(seq 1 60); do
  RESOLVED="$(getent hosts "$FQDN" | awk '{print $1}' | head -n1 || true)"
  if [ "$RESOLVED" = "$MY_IP" ]; then
    echo "DNS resolved after $((i * 15))s"
    break
  fi
  sleep 15
done

# ── Swap in the real Let's Encrypt cert ──────────────────────────────────────
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot -d "$FQDN" --email "$LETSENCRYPT_EMAIL" --agree-tos --non-interactive

docker compose -f docker-compose.yml -f docker-compose.prod.yml restart nginx

echo "=== mts bootstrap complete $(date -u) ==="
