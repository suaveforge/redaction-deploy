#!/bin/bash
set -Eeuo pipefail
D=/home/ggul-docker/bin/docker
S=unix:///home/ggul-docker/run/docker.sock
d(){ "$D" -H "$S" "$@"; }
NAME=suaveforge-redaction-https
BASE=/home/redaction-tls
HOST=api-redaction.suaveforge.com
test -s /home/suaveforge/secrets/spaceship.env
test -s config/nginx.conf
curl -fsS http://127.0.0.1:18847/api/health | grep -q '"worker":true'
if d container inspect "$NAME" >/dev/null 2>&1; then
  test "$(d inspect --format '{{.State.Running}}' "$NAME")" = true
  curl -fsS --max-time 10 "https://$HOST:19447/api/health"
  exit 0
fi
if ss -ltn | grep -q ':19447 '; then echo REDACTION_TLS_PORT_CONFLICT; exit 1; fi
d run --rm --network none -v "$BASE:/redaction" alpine:3.20 sh -ec 'umask 077; mkdir -p /redaction/account /redaction/live /redaction/nginx; chmod 700 /redaction/account /redaction/live /redaction/nginx'
d run --rm -i --network none -v "$BASE:/redaction" alpine:3.20 sh -ec 'umask 077; cat > /redaction/nginx/redaction.conf' < config/nginx.conf
d run --rm --network bridge --cap-drop ALL --security-opt no-new-privileges \
 -v /home/suaveforge/secrets/spaceship.env:/run/spaceship.env:ro \
 -v "$BASE/account:/acme.sh" -v "$BASE/live:/redaction-tls" \
 --entrypoint /bin/sh neilpang/acme.sh:latest -ec '
   set -a; . /run/spaceship.env; set +a
   export SPACESHIP_ROOT_DOMAIN=suaveforge.com
   test -n "$SPACESHIP_API_KEY"; test -n "$SPACESHIP_API_SECRET"
   acme.sh --issue --dns dns_spaceship --server letsencrypt --keylength ec-256 --dnssleep 120 -d api-redaction.suaveforge.com --home /acme.sh
   acme.sh --install-cert --ecc -d api-redaction.suaveforge.com --home /acme.sh --key-file /redaction-tls/privkey.pem --fullchain-file /redaction-tls/fullchain.pem
   chmod 600 /redaction-tls/privkey.pem; chmod 644 /redaction-tls/fullchain.pem
 '
d run --rm --network host -v "$BASE/nginx/redaction.conf:/etc/nginx/conf.d/default.conf:ro" -v "$BASE/live:/etc/redaction-tls:ro" nginx:1.27-alpine nginx -t
d run -d --name "$NAME" --restart unless-stopped --network host --read-only \
 --cap-drop ALL --cap-add CHOWN --cap-add SETUID --cap-add SETGID --security-opt no-new-privileges --memory 128m --pids-limit 80 \
 --tmpfs /var/cache/nginx:rw,nosuid,nodev,size=32m --tmpfs /var/run:rw,nosuid,nodev,size=4m \
 -v "$BASE/nginx/redaction.conf:/etc/nginx/conf.d/default.conf:ro" -v "$BASE/live:/etc/redaction-tls:ro" nginx:1.27-alpine >/dev/null
for i in $(seq 1 24); do
  if curl -fsS --connect-timeout 5 --max-time 8 "https://$HOST:19447/api/health" | grep -q '"worker":true'; then echo REDACTION_PUBLIC_API_HTTPS=PASS; exit 0; fi
  sleep 5
done
echo REDACTION_PUBLIC_HTTPS_UNVERIFIED
exit 1
