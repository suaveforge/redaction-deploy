#!/bin/bash
set -Eeuo pipefail
D=/home/ggul-docker/bin/docker
S=unix:///home/ggul-docker/run/docker.sock
d(){ "$D" -H "$S" "$@"; }
REV="$GITHUB_SHA"
IMAGE="suaveforge-redaction:$REV"
WEB=suaveforge-redaction-web
WORKER=suaveforge-redaction-worker
test -x "$D"
test -f Dockerfile
if d container inspect "$WEB" >/dev/null 2>&1; then
  test "$(d port "$WEB" 8080/tcp)" = "127.0.0.1:18847"
else
  if ss -ltn | grep -q ':18847 '; then echo REDACTION_PORT_CONFLICT; exit 1; fi
fi
for n in "$WEB-previous" "$WORKER-previous"; do
  if d container inspect "$n" >/dev/null 2>&1; then echo REDACTION_PREVIOUS_RELEASE_REVIEW_REQUIRED; exit 1; fi
done
d build -t "$IMAGE" .
d run --rm --network none --entrypoint python "$IMAGE" -m unittest discover -s tests -p 'test_*.py' -v
echo REDACTION_REAL_DOCUMENT_AND_ACCESS_TESTS=PASS
d volume create suaveforge_redaction_data >/dev/null
d volume create suaveforge_redaction_secrets >/dev/null
d run --rm --network none --user 0 --entrypoint python \
  -v suaveforge_redaction_data:/data -v suaveforge_redaction_secrets:/secrets \
  "$IMAGE" -c 'import os,secrets,pathlib
os.umask(0o077)
p=pathlib.Path("/secrets/runtime.env")
if not p.exists():
    p.write_text("REDACTION_SECRET="+secrets.token_hex(48)+"\nREDACTION_ADMIN_PASSWORD="+secrets.token_urlsafe(30)+"\n")
os.chown(p,10001,10001);os.chmod(p,0o600)
for path in ("/data","/secrets"):os.chown(path,10001,10001);os.chmod(path,0o700)'
for n in "$WEB" "$WORKER"; do
  if d container inspect "$n" >/dev/null 2>&1; then d stop "$n" >/dev/null; d rename "$n" "$n-previous"; fi
done
rollback(){
  for n in "$WEB" "$WORKER"; do
    d rm -f "$n" >/dev/null 2>&1 || true
    if d container inspect "$n-previous" >/dev/null 2>&1; then d rename "$n-previous" "$n"; d start "$n" >/dev/null; fi
  done
}
trap rollback ERR
start_container(){
  name="$1"; shift
  d run -d --name "$name" --restart unless-stopped --init --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,size=2g --memory 3g --pids-limit 256 -e REDACTION_REVISION="$REV" -e REDACTION_DATA=/data -e COOKIE_SECURE=1 -e FRONTEND_ORIGIN=https://redaction.suaveforge.com -e PUBLIC_API_ORIGIN=https://api-redaction.suaveforge.com:19447 -v suaveforge_redaction_data:/data -v suaveforge_redaction_secrets:/secrets:ro "$@"
}
start_container "$WEB" -p 127.0.0.1:18847:8080 --entrypoint sh "$IMAGE" -ec 'set -a; . /secrets/runtime.env; set +a; exec sh entrypoint.sh' >/dev/null
start_container "$WORKER" --network none --entrypoint sh "$IMAGE" -ec 'set -a; . /secrets/runtime.env; set +a; exec python worker.py' >/dev/null
ok=0
for i in $(seq 1 40); do
  if curl -fsS --max-time 4 http://127.0.0.1:18847/api/health | grep -q '"worker":true'; then ok=1;break;fi
  sleep 2
done
test "$ok" = 1
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18847/api/documents)" = 401
curl -fsS http://127.0.0.1:18847/api/health | grep -Fq "$REV"
trap - ERR
for n in "$WEB" "$WORKER"; do d rm -f "$n-previous" >/dev/null 2>&1 || true; done
echo REDACTION_ISOLATED_WEB_WORKER=PASS
echo "REDACTION_SOURCE_SHA=$REV"
