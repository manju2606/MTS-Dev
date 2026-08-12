#!/bin/sh
# Picks and renders the active nginx server config ourselves (rather than
# relying on the image's own docker-entrypoint.d/20-envsubst-on-templates.sh
# step, which proved unreliable here -- on Windows/WSL2 bind mounts it can
# run before ./nginx/templates is actually visible in the container and
# silently render nothing). We also clear out conf.d/default.conf, the
# stock "Welcome to nginx" page baked into the base image, which also binds
# `listen 80; server_name localhost;` and would otherwise silently win over
# whichever config we render (it sorts first alphabetically).
set -eu

DOMAIN="${DOMAIN:-localhost}"
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

rm -f /etc/nginx/conf.d/*.conf

if [ -f "$CERT" ]; then
    echo "nginx: TLS cert found for ${DOMAIN} -- serving HTTPS on :443 (+ :80 redirect)."
    envsubst '${DOMAIN}' < /etc/nginx/templates/https.conf.template > /etc/nginx/conf.d/https.conf
else
    echo "nginx: no TLS cert for ${DOMAIN} yet -- serving plain HTTP on :80 until certbot issues one."
    envsubst '${DOMAIN}' < /etc/nginx/templates/http-only.conf.template > /etc/nginx/conf.d/http-only.conf
fi

exec nginx -g 'daemon off;'
