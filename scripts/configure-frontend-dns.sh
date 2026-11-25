#!/bin/bash
set -Eeuo pipefail
D=/home/ggul-docker/bin/docker
S=unix:///home/ggul-docker/run/docker.sock
test -s /home/suaveforge/secrets/spaceship.env
"$D" -H "$S" run --rm -i --network host --read-only \
 --cap-drop ALL --security-opt no-new-privileges \
 -v /home/suaveforge/secrets/spaceship.env:/run/spaceship.env:ro \
 python:3.11-alpine python - <<'PY'
import json,urllib.request
from pathlib import Path
env={}
for l in Path('/run/spaceship.env').read_text().splitlines():
    if '=' in l and not l.lstrip().startswith('#'):
        k,v=l.split('=',1);env[k.strip()]=v.strip().strip('"').strip("'")
base='https://spaceship.dev/api/v1/dns/records/suaveforge.com'
headers={'X-Api-Key':env['SPACESHIP_API_KEY'],'X-Api-Secret':env['SPACESHIP_API_SECRET'],'Accept':'application/json','Content-Type':'application/json'}
def request(method='GET',body=None):
    url=base+('?take=500&skip=0' if method=='GET' else '')
    req=urllib.request.Request(url,method=method,headers=headers,data=None if body is None else json.dumps(body).encode())
    with urllib.request.urlopen(req,timeout=30) as r:
        return json.load(r) if method=='GET' else r.status
def matching():
    obj=request();items=obj.get('items',obj.get('records',obj.get('data',{}).get('items',[])))
    if not isinstance(items,list):raise RuntimeError('Unexpected DNS response')
    return [x for x in items if str(x.get('name','')).lower().strip('.') in ('redaction','redaction.suaveforge.com')]
def valid(items):
    return len(items)==1 and items[0].get('type','').upper()=='CNAME' and str(items[0].get('cname','')).lower().rstrip('.')=='suaveforge.github.io'
old=matching()
if old and not valid(old):raise RuntimeError('Redaction DNS conflict; refusing overwrite')
if not old:
    assert request('PUT',{'force':False,'items':[{'name':'redaction','type':'CNAME','cname':'suaveforge.github.io','ttl':600}]})==204
assert valid(matching())
print('REDACTION_FRONTEND_CNAME_READBACK=PASS')
PY
