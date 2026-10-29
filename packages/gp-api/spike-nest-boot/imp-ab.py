import os,subprocess,sys,time,re,json,statistics as st
API='/Users/swain/Repos/thegoodparty/omni/.worktrees/test-audit/boot-speed-spike/packages/gp-api'
out=sys.argv[1]; rounds=int(sys.argv[2]); specs=[s.split('|') for s in sys.argv[3:]]
files=os.environ.get('IMP_FILES','src/nest-boot-bench.test.ts').split()
def run(label,envs,nodedir,record):
    while os.getloadavg()[0]>6: print('load high, sleep 60',flush=True); time.sleep(60)
    env=dict(os.environ)
    if nodedir: env['PATH']=nodedir+':'+env['PATH']
    for kv in filter(None,envs.split(';')):
        k,v=kv.split('=',1); env[k]=v
    t=time.time(); l0=os.getloadavg()[0]
    p=subprocess.run(['npx','vitest','run',*files],cwd=API,env=env,capture_output=True,text=True)
    wall=time.time()-t
    m=re.search(r'Duration\s+([\d.]+)(m?s) \(transform ([\d.]+)(m?s), setup ([\d.]+)(m?s), import ([\d.]+)(m?s), tests ([\d.]+)(m?s)',p.stdout)
    sec=lambda v,u: float(v)/(1000 if u=='ms' else 1)
    r=dict(label=label,exit=p.returncode,wall=wall,load=l0)
    if m:
        g=m.groups(); r.update(duration=sec(g[0],g[1]),transform=sec(g[2],g[3]),setup=sec(g[4],g[5]),imp=sec(g[6],g[7]),tests=sec(g[8],g[9]))
    else: print(p.stdout[-2000:],p.stderr[-2000:])
    print(json.dumps(r),flush=True)
    if record: open(out,'a').write(json.dumps(r)+'\n')
for s in specs: run(*s,False)
for i in range(rounds):
    for s in specs: run(*s,True)
