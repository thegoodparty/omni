import json,sys,statistics as st
from collections import defaultdict
g=defaultdict(list)
for l in open(sys.argv[1]): d=json.loads(l); g[d['label']].append(d)
print(f"{'label':16} {'n':>2} {'wall':>6} {'duration':>8} {'transform':>9} {'import':>7} {'tests':>6} load")
for k,v in g.items():
    m=lambda f: st.median([x[f] for x in v if f in x])
    print(f"{k:16} {len(v):2} {m('wall'):6.2f} {m('duration'):8.2f} {m('transform'):9.2f} {m('imp'):7.2f} {m('tests'):6.2f} {min(x['load'] for x in v):.1f}-{max(x['load'] for x in v):.1f}")
