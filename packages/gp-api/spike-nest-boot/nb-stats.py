import json,sys,statistics as st
from collections import defaultdict
path=sys.argv[1]; base=sys.argv[2] if len(sys.argv)>2 else 'base'
key=sys.argv[3] if len(sys.argv)>3 else 'variant'
rows=[json.loads(l) for l in open(path)]
for r in rows: r['lv']=r['label']+('/'+r['variant'] if r['variant']!='base' else '')
g=defaultdict(list)
for r in rows: g[r[key]].append(r)
def p(xs,q):
  xs=sorted(xs); return xs[min(len(xs)-1,int(round(q*(len(xs)-1))))]
mb={m:st.median([r[m] for r in g[base]]) for m in ['create','init','total','gcMs']} if base in g else None
print(f"{'variant':28} {'n':>3} {'create med/p90':>15} {'init med/p90':>13} {'total med/p90':>14} {'d total':>8} {'gc ms med':>9} {'load':>9}")
for v,rs in g.items():
  c=[r['create'] for r in rs]; i=[r['init'] for r in rs]; t=[r['total'] for r in rs]; gc=[r['gcMs'] for r in rs]; l=[r['load'] for r in rs]
  d=f"{st.median(t)-mb['total']:+.0f}" if mb else ''
  print(f"{v:28} {len(rs):3} {st.median(c):7.0f}/{p(c,.9):<7.0f} {st.median(i):6.0f}/{p(i,.9):<6.0f} {st.median(t):7.0f}/{p(t,.9):<6.0f} {d:>8} {st.median(gc):9.1f} {min(l):4.1f}-{max(l):4.1f}")
