import json,sys,collections,re
p=json.load(open(sys.argv[1])); root=sys.argv[2]; nb=float(sys.argv[3]) if len(sys.argv)>3 else 1
nodes={n['id']:n for n in p['nodes']}
parent={}
for n in p['nodes']:
    for c in n.get('children',[]): parent[c]=n['id']
dt=collections.Counter()
for s,d in zip(p['samples'],p['timeDeltas']): dt[s]+=d/1000
def pkg(url):
    m=re.search(r'node_modules/((@[^/]+/)?[^/]+)',url)
    return m.group(1) if m else url.split('/')[-1][:40]
selff=collections.Counter(); tot=0
for nid,t in dt.items():
    x=nid; inside=False
    while x is not None:
        if nodes[x]['callFrame']['functionName']==root: inside=True;break
        x=parent.get(x)
    if not inside: continue
    tot+=t
    cf=nodes[nid]['callFrame']; selff[f"{cf['functionName'] or '(anon)'} {pkg(cf['url'])}:{cf['lineNumber']}"]+=t
print(f'{root}: {tot/nb:.1f}ms per boot')
for k,v in selff.most_common(int(sys.argv[4]) if len(sys.argv)>4 else 15): print(f'  {v/nb:6.2f} {k}')
