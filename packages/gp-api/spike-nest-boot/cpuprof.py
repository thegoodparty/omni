import json,sys,re,collections
p=json.load(open(sys.argv[1]))
nodes={n['id']:n for n in p['nodes']}
parent={}
for n in p['nodes']:
    for c in n.get('children',[]): parent[c]=n['id']
dt=collections.Counter()
samples=p['samples']; deltas=p['timeDeltas']
for s,d in zip(samples,deltas): dt[s]+=d/1000
total=sum(dt.values())
def pkg(url):
    m=re.search(r'node_modules/((@[^/]+/)?[^/]+)',url)
    if m: return m.group(1)
    if 'gp-api/src' in url: return 'gp-api/src'
    return url[:60] or '(native/program)'
selfpkg=collections.Counter(); selffn=collections.Counter()
for nid,t in dt.items():
    cf=nodes[nid]['callFrame']
    selfpkg[pkg(cf['url'])]+=t
    selffn[(cf['functionName'] or '(anon)')+' '+pkg(cf['url'])+':'+str(cf['lineNumber'])]+=t
print(f'total sampled {total:.0f}ms')
print('self by package:')
for k,v in selfpkg.most_common(15): print(f'  {v:7.0f} {k}')
print('self by function:')
for k,v in selffn.most_common(25): print(f'  {v:7.0f} {k}')
# inclusive for named functions
incl=collections.Counter()
for nid,t in dt.items():
    seen=set(); x=nid
    while x is not None:
        cf=nodes[x]['callFrame']; key=cf['functionName']+' '+pkg(cf['url'])
        if key not in seen: incl[key]+=t; seen.add(key)
        x=parent.get(x)
print('inclusive (selected):')
for k,v in incl.most_common(80):
    if any(w in k for w in sys.argv[2:]): print(f'  {v:7.0f} {k}')
