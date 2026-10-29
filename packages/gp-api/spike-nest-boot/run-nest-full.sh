#!/bin/bash
# usage: run-nest-full.sh <tag> <nodedir> <nestver> [ENV=VAL ...]
set -u
WT=/Users/swain/Repos/thegoodparty/omni/.worktrees/test-audit/boot-speed-spike
API=$WT/packages/gp-api
H=/tmp/gp-api-test-audit/round2/nest/harness
tag=$1; nodedir=$2; nestver=$3; shift 3
for i in $(seq 1 10); do
  l=$(sysctl -n vm.loadavg | awk '{print $2}')
  if awk "BEGIN{exit !($l > 6)}"; then echo "load $l > 6, sleep 60"; sleep 60; else break; fi
done
for p in core common; do rm -rf $WT/node_modules/@nestjs/$p; cp -R /tmp/nestv/mods/$nestver/$p $WT/node_modules/@nestjs/$p; done
cd $API
for f in src/test-service.ts src/test-global-setup.ts vitest.config.ts; do cp $f /tmp/gp-api-test-audit/round2/nest/harness/$(basename $f).branch; cp $H/$(basename $f) $f; done
out=/tmp/gp-api-test-audit/round2/runs/$tag
rm -rf $out; mkdir -p $out
load0=$(sysctl -n vm.loadavg | awk '{print $2}')
s=$(python3 -c 'import time;print(time.time())')
TIMEFORMAT='%U %S'
{ time env PATH=$nodedir:$PATH BOOT_PROFILE_DIR=$out/prof "$@" npx vitest run --exclude "**/test-service.reuse.test.ts" --reporter=json --reporter=default --outputFile.json=$out/report.json > $out/log.txt 2>&1 ; } 2> $out/cpu.txt
code=$?
e=$(python3 -c 'import time;print(time.time())')
load1=$(sysctl -n vm.loadavg | awk '{print $2}')
for f in src/test-service.ts src/test-global-setup.ts vitest.config.ts; do cp /tmp/gp-api-test-audit/round2/nest/harness/$(basename $f).branch $f; done
for p in core common; do rm -rf $WT/node_modules/@nestjs/$p; cp -R /tmp/nestv/mods/11.1.27/$p $WT/node_modules/@nestjs/$p; done
cpu=$(awk '{print $1+$2}' $out/cpu.txt)
dur=$(grep -E '^\s+Duration' $out/log.txt | tail -1 | sed 's/^ *//')
python3 - "$out" "$tag" "$code" "$s" "$e" "$load0" "$load1" "$cpu" "$dur" "$*" <<'PY'
import json,sys
out,tag,code,s,e,l0,l1,cpu,dur,envs=sys.argv[1:]
d=json.load(open(out+'/report.json'))
fails=[f"{r['name'].split('gp-api/')[-1]}::{a['title']}" for r in d['testResults'] for a in r['assertionResults'] if a['status']=='failed']
summ=dict(tag=tag,exit=int(code),cpu=float(cpu),wall=round(float(e)-float(s),1),tests=d['numTotalTests'],failed=d['numFailedTests'],load_start=l0,load_end=l1,duration=dur,env=envs,fails=fails)
print(json.dumps(summ))
open('/tmp/gp-api-test-audit/round2/runs/nest-summary.jsonl','a').write(json.dumps(summ)+'\n')
PY
