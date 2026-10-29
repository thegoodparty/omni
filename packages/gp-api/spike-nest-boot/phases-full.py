import json,glob,sys,statistics as st
tag=sys.argv[1]
rows=[]
for f in glob.glob(f'/tmp/gp-api-test-audit/round2/runs/{tag}/prof/*.jsonl'):
    for l in open(f): rows.append(json.loads(l))
P=[('testPostgresUri (testcontainers lookup)','start','testPostgresUri'),
   ('admin connect','testPostgresUri','adminConnect'),
   ('CREATE DATABASE ... TEMPLATE','adminConnect','cloneDb'),
   ('FastifyAdapter + websocket plugin','bootstrapStart','adapterReady'),
   ('NestFactory.create (scan + DI instantiate)','adapterReady','nestFactoryCreate'),
   ('bootstrap tail (helmet/cors/static/cookie/multipart, filters)','nestFactoryCreate','bootstrapReturned'),
   ('app.init (router registration + onModuleInit hooks incl. Prisma $connect)','bootstrapReturned','appInit'),
   ('harness spies','appInit','spies'),
   ('app.listen','spies','listen'),
   ('tables query','listen','tablesQuery'),
   ('app.close','afterAllStart','appClose'),
   ('DROP DATABASE WITH (FORCE)','appClose','dropDb')]
tot=[]
out=[]
for name,a,b in P:
    v=[dict(r['marks'])[b]-dict(r['marks'])[a] for r in rows if a in dict(r['marks']) and b in dict(r['marks'])]
    out.append((name,st.median(v),st.mean(v),sum(v)/1000))
for r in rows:
    m=dict(r['marks']); tot.append((m['tablesQuery']-m['start'])+(m['dropDb']-m['afterAllStart']))
print(f'{tag}: n={len(rows)} files; total median {st.median(tot):.0f}ms mean {st.mean(tot):.0f}ms sum {sum(tot)/1000:.1f}s')
print('| Phase | Median ms | Mean ms | Sum over run (s) |')
print('|---|---|---|---|')
for name,med,mean,s in out: print(f'| {name} | {med:.0f} | {mean:.0f} | {s:.1f} |')
