#!/usr/bin/env python3
# usage: nb-proc.py <out.jsonl> <rounds> <runs-per-proc> <variant-spec>...
# variant-spec: label|ENV=VAL;ENV=VAL|nestver|node-bin-dir|inproc-variants
import os, subprocess, sys, time, shutil

WT = '/Users/swain/Repos/thegoodparty/omni/.worktrees/test-audit/boot-speed-spike'
API = WT + '/packages/gp-api'
MODS = '/tmp/nestv/mods'
out, rounds, runs = sys.argv[1], int(sys.argv[2]), sys.argv[3]
specs = [s.split('|') for s in sys.argv[4:]]


def load1():
    return os.getloadavg()[0]


def wait_quiet():
    waited = 0
    while load1() > 6 and waited < 600:
        print(f'load {load1():.1f} > 6, sleeping 60', flush=True)
        time.sleep(60)
        waited += 60


def set_nest(ver):
    for p in ('core', 'common'):
        dst = f'{WT}/node_modules/@nestjs/{p}'
        shutil.rmtree(dst)
        shutil.copytree(f'{MODS}/{ver}/{p}', dst)


current = None
try:
    for r in range(rounds):
        for label, envs, ver, nodedir, inproc in specs:
            if ver and ver != current:
                set_nest(ver)
                current = ver
            wait_quiet()
            env = dict(os.environ)
            if nodedir:
                env['PATH'] = nodedir + ':' + env['PATH']
            for kv in filter(None, envs.split(';')):
                k, v = kv.split('=', 1)
                env[k] = v
            env.update(BENCH_OUT=out, BENCH_RUNS=runs, BENCH_LABEL=label,
                       BENCH_VARIANTS=inproc or 'base')
            t = time.time()
            p = subprocess.run(['npx', 'vitest', 'run', 'src/nest-boot-bench.test.ts'],
                               cwd=API, env=env, capture_output=True, text=True)
            tail = [l for l in p.stdout.splitlines() if 'Duration' in l or 'Test Files' in l]
            print(f'round {r} {label}: exit {p.returncode} {time.time()-t:.1f}s load {load1():.1f} {tail}', flush=True)
            if p.returncode:
                print(p.stdout[-3000:], p.stderr[-3000:])
                sys.exit(1)
finally:
    if current and current != '11.1.27':
        set_nest('11.1.27')
