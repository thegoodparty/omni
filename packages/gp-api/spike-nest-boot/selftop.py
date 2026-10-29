import json,sys,collections,re
p=json.load(open(sys.argv[1])); nb=float(sys.argv[2])
nodes={n['id']:n for n in p['nodes']}
dt=collections.Counter()
for s,d in zip(p['samples'],p['timeDeltas']): dt[s]+=d/1000
def pkg(url):
    m=re.search(r'node_modules/((@[^/]+/)?[^/]+)',url)
    return m.group(1) if m else url.split('/')[-1][:40]
f=collections.Counter(); pk=collections.Counter(); tot=0
for nid,t in dt.items():
    cf=nodes[nid]['callFrame']
    if cf['functionName'] in ('(idle)','post') or 'inspector' in cf['url']: continue
    tot+=t
    f[f"{cf['functionName'] or '(anon)'} {pkg(cf['url'])}:{cf['lineNumber']}"]+=t; pk[pkg(cf['url']) or cf['functionName']]+=t
print(f'busy {tot/nb:.1f}ms per boot')
for k,v in pk.most_common(12): print(f'  {v/nb:6.2f} {k}')
print('--')
for k,v in f.most_common(int(sys.argv[3]) if len(sys.argv)>3 else 25): print(f'  {v/nb:6.2f} {k}')
