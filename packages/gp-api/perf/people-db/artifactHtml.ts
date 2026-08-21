// Renders a benchmark JSON artifact as a fixed-format HTML page.
//
// The format is deliberately CONSTANT: provenance, the mode's results table,
// then one description table per axis, then the legend. There is no generated
// prose and no analysis -- every word is either fixed boilerplate from this
// file or a description string carried in the JSON. Two runs of the same suite
// therefore differ only in their numbers, which is what makes them comparable.

export type ArtifactCase = {
  id: string
  queryType: string
  band: string
  variant: string
  iterations: number
  failures: number
  errors: string[]
  cold: number | null
  warm: { count: number; p50: number; max: number }
}

export type LoadLevel = {
  concurrency: number
  p50: number
  p95: number
  max: number
  errorRate: number
  throughputPerSec: number
  errors: string[]
}

export type LoadScenarioResult = {
  id: string
  levels: LoadLevel[]
  passed: boolean
}

export type Descriptions = {
  queries?: Record<string, string>
  variants?: Record<string, string>
  bands?: Record<
    string,
    { district: string; partition: string; description: string }
  >
}

type Meta = {
  env: string
  mode: string
  gitSha: string
  startedAt: string
  idSet?: { size: number; seed: string }
  descriptions?: Descriptions
}

export type ArtifactData = Meta & { results: ArtifactCase[] }
export type LoadArtifactData = Meta & { results: LoadScenarioResult[] }

const BAND_ORDER = ['small', 'medium', 'large', 'mega', 'statewide']
const QUERY_ORDER = [
  'list',
  'count',
  'list-detail',
  'search',
  'sample',
  'overlap',
  'csv',
  'stats',
]
const VARIANT_ORDER = [
  'none',
  'single-boolean',
  'single-multivalue',
  'broad-lowselectivity',
  'narrow-highselectivity',
  'numeric-range',
  'channel-landline',
  'channel-address',
  'outreach-include',
  'outreach-exclude',
  'outreach-mixed',
]
const VARIED = new Set(['list', 'count', 'list-detail'])

// The page is emitted as pure ASCII: the artifact host supplies the <head>, so
// a non-ASCII byte here renders as mojibake when its charset differs.
const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0080-\uffff]/g, (c) => `&#${c.charCodeAt(0)};`)

const CSS = `
:root{--ground:#f4f6f8;--surface:#fff;--sunk:#eef1f5;--ink:#14181f;
--ink2:#4a5464;--ink3:#7b8698;--rule:#dce3ea;--rule2:#c3ced9;--accent:#1d4e6b;
--ok:#eaf0f6;--okI:#14181f;--mod:#c9dceb;--modI:#14181f;--hvy:#8fb8d4;
--hvyI:#0b1b26;--ceil:#f0c46a;--ceilI:#4a2e05;--past:#d98070;--pastI:#40100a;
--mark:#8c2018;--tipBg:#14181f;--tipI:#f4f6f8}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
--ground:#0e1319;--surface:#151b23;--sunk:#10161d;--ink:#e8edf3;--ink2:#a4b0bf;
--ink3:#74808f;--rule:#263140;--rule2:#35434f;--accent:#6fa8c9;--ok:#1b2733;
--okI:#dce5ee;--mod:#22415c;--modI:#e4edf5;--hvy:#2e5f86;--hvyI:#eaf2f8;
--ceil:#6b4a12;--ceilI:#f7dfa8;--past:#6e2b22;--pastI:#f6c9c1;--mark:#f0a79c;
--tipBg:#e8edf3;--tipI:#0e1319}}
:root[data-theme="dark"]{--ground:#0e1319;--surface:#151b23;--sunk:#10161d;
--ink:#e8edf3;--ink2:#a4b0bf;--ink3:#74808f;--rule:#263140;--rule2:#35434f;
--accent:#6fa8c9;--ok:#1b2733;--okI:#dce5ee;--mod:#22415c;--modI:#e4edf5;
--hvy:#2e5f86;--hvyI:#eaf2f8;--ceil:#6b4a12;--ceilI:#f7dfa8;--past:#6e2b22;
--pastI:#f6c9c1;--mark:#f0a79c;--tipBg:#e8edf3;--tipI:#0e1319}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-size:16px;
line-height:1.55;font-family:"Source Serif 4",Georgia,serif}
.wrap{max-width:1180px;margin:0 auto;padding:36px 24px 88px;display:flex;
flex-direction:column;gap:38px}
h1{font-family:Archivo,system-ui,sans-serif;font-weight:700;
font-size:clamp(26px,4vw,40px);letter-spacing:-.022em;line-height:1.05;
margin:8px 0 0;text-wrap:balance}
h2{font-family:Archivo,system-ui,sans-serif;font-weight:600;font-size:19px;
letter-spacing:-.01em;margin:0}
.eyebrow{font-family:Archivo,system-ui,sans-serif;font-size:11px;
font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--ink3)}
header{border-bottom:2px solid var(--ink);padding-bottom:22px}
section{display:flex;flex-direction:column;gap:14px}
.sec-head{border-bottom:1px solid var(--rule2);padding-bottom:10px;
display:flex;flex-direction:column;gap:6px}
code,.mono{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;
font-variant-numeric:tabular-nums}
.prov{margin-top:20px;display:grid;grid-template-columns:repeat(4,1fr);gap:1px;
background:var(--rule);border:1px solid var(--rule)}
@media(max-width:780px){.prov{grid-template-columns:repeat(2,1fr)}}
.prov>div{background:var(--surface);padding:10px 12px;display:flex;
flex-direction:column;gap:2px}
.prov dt{font-family:Archivo,system-ui,sans-serif;font-size:10px;
font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3)}
.prov dd{margin:0;font-family:"IBM Plex Mono",monospace;font-size:12.5px;
font-variant-numeric:tabular-nums;word-break:break-word}
.controls{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center}
.seg{display:inline-flex;border:1px solid var(--rule2);border-radius:3px;
overflow:hidden;background:var(--surface)}
.seg button{font-family:Archivo,system-ui,sans-serif;font-size:12px;
font-weight:600;padding:7px 13px;border:0;border-right:1px solid var(--rule2);
background:transparent;color:var(--ink2);cursor:pointer}
.seg button:last-child{border-right:0}
.seg button[aria-pressed="true"]{background:var(--accent);color:var(--surface)}
:root[data-theme="dark"] .seg button[aria-pressed="true"],
:root:not([data-theme="light"]) .seg button[aria-pressed="true"]{
color:var(--ground)}
.seg button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
.lg{display:inline-flex;align-items:center;gap:6px;
font-family:Archivo,system-ui,sans-serif;font-size:11.5px;color:var(--ink2)}
.sw{width:22px;height:13px;border:1px solid var(--rule2);border-radius:2px}
.scroller{overflow-x:auto;border:1px solid var(--rule);background:var(--surface)}
table{border-collapse:separate;border-spacing:0;width:100%}
table.matrix{min-width:980px}
thead th{position:sticky;top:0;z-index:3;background:var(--surface);
font-family:Archivo,system-ui,sans-serif;font-size:11px;font-weight:600;
letter-spacing:.1em;text-transform:uppercase;color:var(--ink2);
padding:10px;border-bottom:1.5px solid var(--ink);white-space:nowrap;
text-align:left}
thead th .sub{display:block;font-family:"IBM Plex Mono",monospace;
font-size:10px;font-weight:400;letter-spacing:0;text-transform:none;
color:var(--ink3);margin-top:2px}
thead th.rowhead{z-index:4;left:0}
.rowhead{position:sticky;left:0;background:var(--surface);z-index:2;
border-right:1px solid var(--rule2);padding:0 12px;white-space:nowrap;
text-align:left}
td.rowhead .q{font-family:"IBM Plex Mono",monospace;font-size:12px;
font-weight:600;color:var(--ink)}
td.rowhead .v{font-family:"IBM Plex Mono",monospace;font-size:11px;
color:var(--ink3)}
tr.grp td,tr.grp th{border-top:1px solid var(--rule2)}
td.cell{padding:0;border-bottom:1px solid var(--rule);
border-right:1px solid var(--rule)}
.cellbox{display:block;width:100%;padding:8px 10px 7px;min-height:44px;
text-align:left;border:0;background:transparent;font:inherit;cursor:help}
.cellbox:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.val{font-family:"IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;
font-size:13.5px;font-weight:600;display:block}
.sub2{font-family:"IBM Plex Mono",monospace;font-variant-numeric:tabular-nums;
font-size:10.5px;display:block;opacity:.72;margin-top:1px}
.s-ok{background:var(--ok)}.s-ok .val,.s-ok .sub2{color:var(--okI)}
.s-mod{background:var(--mod)}.s-mod .val,.s-mod .sub2{color:var(--modI)}
.s-hvy{background:var(--hvy)}.s-hvy .val,.s-hvy .sub2{color:var(--hvyI)}
.s-ceil{background:var(--ceil)}.s-ceil .val,.s-ceil .sub2{color:var(--ceilI)}
.s-past{background:var(--past)}.s-past .val,.s-past .sub2{color:var(--pastI)}
.s-empty{background:var(--sunk)}
.s-empty .val{color:var(--ink3);font-weight:400}
.fmark{display:inline-block;font-family:"IBM Plex Mono",monospace;
font-size:10px;font-weight:600;padding:0 3px;margin-left:4px;border-radius:2px;
background:var(--mark);color:var(--surface);vertical-align:1px}
:root[data-theme="dark"] .fmark,:root:not([data-theme="light"]) .fmark{
color:var(--ground)}
table.dt{font-family:"IBM Plex Mono",monospace;font-size:12.5px;
font-variant-numeric:tabular-nums;min-width:620px}
table.dt td{padding:9px 12px;border-bottom:1px solid var(--rule);
color:var(--ink2);vertical-align:top;text-align:left}
table.dt td.k{color:var(--ink);font-weight:500;white-space:nowrap}
table.dt td.desc{font-family:"Source Serif 4",Georgia,serif;font-size:15px;
line-height:1.5;min-width:340px}
table.dt td.num{text-align:right;white-space:nowrap}
table.dt tbody tr:last-child td{border-bottom:0}
.bad{color:var(--mark);font-weight:600}
#tip{position:fixed;z-index:50;max-width:370px;background:var(--tipBg);
color:var(--tipI);border-radius:4px;padding:10px 12px;
font-family:"IBM Plex Mono",monospace;font-size:11.5px;line-height:1.5;
pointer-events:none;opacity:0;transition:opacity .1s}
#tip.on{opacity:1}
#tip .tt{font-weight:600;display:block;margin-bottom:5px}
#tip .r{display:flex;justify-content:space-between;gap:14px}
#tip .r span:first-child{opacity:.68}
#tip .e{display:block;margin-top:6px;opacity:.85;white-space:normal}
#tip .d{display:block;font-family:"Source Serif 4",Georgia,serif;
font-size:12.5px;line-height:1.45;margin-bottom:6px;white-space:normal;
opacity:.92}
#tip .d b{font-family:"IBM Plex Mono",monospace;font-size:11px;font-weight:600}
#tip .d+.r{margin-top:6px;padding-top:6px;
border-top:1px solid rgba(127,127,127,.35)}
.notes{display:flex;flex-direction:column;gap:10px;max-width:70ch}
.notes p{margin:0;color:var(--ink2)}
.notes code{font-size:.86em;background:var(--sunk);border:1px solid var(--rule);
border-radius:3px;padding:.06em .34em;color:var(--ink)}
footer{border-top:1px solid var(--rule);padding-top:16px;color:var(--ink3);
font-size:13px;display:flex;flex-direction:column;gap:4px}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}.loadcell{display:block;padding:6px 8px;border-radius:2px}
.loadcell .val{font-size:12.5px}
`

// The only prose on the page, and it is identical on every run, so it can
// never become per-run commentary.
const HOW_TO_READ = [
  'Cells show the selected metric. <code>cold</code> is the first hit on an ' +
    'unwarmed buffer pool; <code>p50</code> and <code>max</code> are over the ' +
    'warm runs after it. Read cold first: the people-db loader cuts ' +
    'production over to a brand-new cluster, so in production every district ' +
    'is cold at once.',
  'Warm figures are p50 and max, never p95 &#8212; seven samples cannot ' +
    'estimate a 95th percentile, so max is the honest worst seen. A wide gap ' +
    'between p50 and max means an intermittent stall.',
  'Color encodes proximity to the 25s statement timeout ' +
    '(<code>STATEMENT_TIMEOUT_MS</code>). Every cell also prints its number ' +
    'and failing cells carry a count badge, so nothing is conveyed by color ' +
    'alone. <code>timeout</code> means no run succeeded at that metric; ' +
    '<code>not run</code> means the case was never emitted.',
  '<code>csv</code> is the one path that sets ' +
    '<code>statement_timeout = 0</code>, so its cells are not bounded by the ' +
    'ceiling the rest of the table is judged against.',
]

const STEPS: [string, string][] = [
  ['under 2s', 'var(--ok)'],
  ['2-10s', 'var(--mod)'],
  ['10-20s', 'var(--hvy)'],
  ['20-25s at the cap', 'var(--ceil)'],
  ['past 25s', 'var(--past)'],
]

// The payload does not pass through esc(), so it needs the same two guarantees
// on its own: a literal `</script>` would close the tag early and spill the
// rest of the JSON into the document, and a non-ASCII byte renders as mojibake
// when the host's charset differs. Descriptions are authored text and error
// strings come from the database, so neither is trusted here.
const jsonForScript = (json: string): string =>
  json
    .replace(/</g, '\\u003c')
    .replace(
      /[\u0080-\uffff]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    )

const dtable = (
  headers: string[],
  rows: string[][],
  cls: string[] = [],
): string => {
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('')
  const body = rows
    .map(
      (r) =>
        '<tr>' +
        r.map((c, i) => `<td class="${cls[i] ?? ''}">${c}</td>`).join('') +
        '</tr>',
    )
    .join('')
  return (
    `<div class="scroller"><table class="dt"><thead><tr>${head}</tr>` +
    `</thead><tbody>${body}</tbody></table></div>`
  )
}

type ResultsSection = { title: string; body: string; controls?: string }

// The one shell both modes render into: header, the mode's own results table,
// then the SAME description tables and legend in the SAME order every time.
const page = (
  meta: Meta,
  prov: [string, string][],
  results: ResultsSection,
  opts: { bands?: string[]; extra?: string; script?: string } = {},
): string => {
  const d = meta.descriptions ?? {}
  const bands = opts.bands ?? BAND_ORDER.filter((b) => d.bands?.[b])
  const cohortRows = bands.map((b) => [
    `<span class="mono">${esc(b)}</span>`,
    esc(d.bands?.[b]?.district ?? ''),
    esc(d.bands?.[b]?.partition ?? ''),
    esc(d.bands?.[b]?.description ?? ''),
  ])
  const queryRows = QUERY_ORDER.filter((q) => d.queries?.[q]).map((q) => [
    `<span class="mono">${esc(q)}</span>`,
    esc(d.queries?.[q] ?? ''),
  ])
  const variantRows = VARIANT_ORDER.filter((v) => d.variants?.[v]).map((v) => [
    `<span class="mono">${esc(v)}</span>`,
    esc(d.variants?.[v] ?? ''),
  ])
  const provHtml = prov
    .map(([k, v]) => `    <div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
    .join('\n')
  const notes = HOW_TO_READ.map((x) => `    <p>${x}</p>`).join('\n')

  return `<title>people-db Benchmark ${esc(meta.env)} ${esc(meta.gitSha)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>${CSS}</style>
<div class="wrap">
<header>
  <div class="eyebrow">gp-api &#183; perf/people-db &#183; ${esc(meta.mode)} mode</div>
  <h1>people-db Benchmark</h1>
  <dl class="prov">
${provHtml}
  </dl>
</header>

<section>
  <div class="sec-head">
    <h2>${esc(results.title)}</h2>
    ${results.controls ?? ''}
  </div>
  ${results.body}
</section>

${opts.extra ?? ''}

<section>
  <div class="sec-head"><h2>Cohorts</h2></div>
  ${dtable(['Band', 'District', 'State partition', 'What it is'], cohortRows, ['k', '', '', 'desc'])}
</section>

<section>
  <div class="sec-head"><h2>Query types</h2></div>
  ${dtable(['Query', 'What it measures'], queryRows, ['k', 'desc'])}
</section>

<section>
  <div class="sec-head"><h2>Filter variants</h2></div>
  ${dtable(['Variant', 'What it is'], variantRows, ['k', 'desc'])}
</section>

<section>
  <div class="sec-head"><h2>How to read this</h2></div>
  <div class="notes">
${notes}
  </div>
</section>

<footer>
  <div class="mono">people-db-bench-${esc(meta.env)}-${esc(meta.gitSha)}-${esc(meta.mode)}.json</div>
  <div class="mono">npm run perf:people-db -- --mode=${esc(meta.mode)} --env=${esc(meta.env)}</div>
</footer>
</div>
${opts.script ?? ''}
`
}

const buildLatencyHtml = (data: ArtifactData): string => {
  const d = data.descriptions ?? {}
  const bands = BAND_ORDER.filter((b) => data.results.some((r) => r.band === b))
  const failing = [...data.results]
    .filter((r) => r.failures > 0)
    .sort((a, b) => b.failures / b.iterations - a.failures / a.iterations)

  const rows: { q: string; v: string; first: boolean }[] = []
  for (const q of QUERY_ORDER) {
    const forQ = data.results.filter((r) => r.queryType === q)
    if (!forQ.length) continue
    const vs = VARIED.has(q)
      ? VARIANT_ORDER.filter((v) => forQ.some((r) => r.variant === v))
      : ['none']
    vs.forEach((v, i) => rows.push({ q, v, first: i === 0 }))
  }

  const prov: [string, string][] = [
    ['Mode', data.mode],
    ['Environment', data.env],
    ['Commit', data.gitSha],
    ['Recorded', data.startedAt],
    ['Cells', String(data.results.length)],
    ['Failing cells', String(failing.length)],
    ['Id-set size', data.idSet ? String(data.idSet.size) : 'n/a'],
    ['Id-set seed', data.idSet ? data.idSet.seed : 'n/a'],
  ]

  const legend =
    STEPS.map(
      ([label, swatch]) =>
        `<span class="lg"><span class="sw" style="background:${swatch}">` +
        `</span>${esc(label)}</span>`,
    ).join('') +
    '<span class="lg"><span class="fmark">2</span>runs that errored</span>' +
    '<span class="lg"><span class="sw" style="background:var(--sunk)">' +
    '</span>not run</span>'

  const controls =
    '<div class="controls"><div class="seg" role="group" aria-label="Metric">' +
    '<button type="button" data-m="cold" aria-pressed="true">Cold</button>' +
    '<button type="button" data-m="p50" aria-pressed="false">Warm p50</button>' +
    '<button type="button" data-m="max" aria-pressed="false">Warm max</button>' +
    `</div></div><div class="legend">${legend}</div>`

  const failRows = failing.map((r) => [
    `<span class="mono">${esc(r.id)}</span>`,
    `<span class="bad">${r.failures} / ${r.iterations}</span>`,
    r.cold === null ? '&#8212;' : String(Math.round(r.cold)),
    r.warm.count ? String(Math.round(r.warm.max)) : '&#8212;',
    esc(r.errors[0] ?? ''),
  ])

  const extra = `
<section>
  <div class="sec-head"><h2>Failures</h2></div>
  ${
    failRows.length
      ? dtable(
          ['Cell', 'Failed', 'Cold', 'Warm max', 'Error returned'],
          failRows,
          ['k', 'num', 'num', 'num', 'desc'],
        )
      : '<p class="mono">No cell recorded a failure.</p>'
  }
</section>`

  const payload = JSON.stringify({
    bands,
    rows,
    cells: data.results.map((r) => ({
      k: `${r.queryType}|${r.band}|${r.variant}`,
      cold: r.cold === null ? null : Math.round(r.cold),
      p50: r.warm.count ? Math.round(r.warm.p50) : null,
      max: r.warm.count ? Math.round(r.warm.max) : null,
      n: r.warm.count,
      it: r.iterations,
      f: r.failures,
      e: r.errors[0] ?? null,
    })),
    bandMeta: Object.fromEntries(
      bands.map((b) => [b, d.bands?.[b]?.district ?? '']),
    ),
    // A cell is a query x variant pair, so the hover carries both
    // descriptions: naming one without the other leaves half the cell
    // unexplained.
    qDesc: d.queries ?? {},
    vDesc: d.variants ?? {},
  })

  const script = `<div id="tip" role="tooltip" aria-hidden="true"></div>
<script type="application/json" id="d">${jsonForScript(payload)}</script>
<script>
(() => {
  const D = JSON.parse(document.getElementById('d').textContent)
  const byK = new Map(D.cells.map((c) => [c.k, c]))
  const t = document.getElementById('matrix')
  const tip = document.getElementById('tip')
  let m = 'cold'
  const sev = (v) => {
    if (v == null) return 's-empty'
    if (v >= 25000) return 's-past'
    if (v >= 20000) return 's-ceil'
    if (v >= 10000) return 's-hvy'
    if (v >= 2000) return 's-mod'
    return 's-ok'
  }
  const fmt = (v) =>
    v == null ? '\\u2014' : v >= 10000 ? (v / 1000).toFixed(1) + 's' : v + 'ms'
  const render = () => {
    let h = '<thead><tr><th class="rowhead">Query / filter</th>'
    for (const b of D.bands) {
      h += '<th>' + b + '<span class="sub">' + (D.bandMeta[b] || '') +
           '</span></th>'
    }
    h += '</tr></thead><tbody>'
    for (const r of D.rows) {
      h += '<tr' + (r.first ? ' class="grp"' : '') + '><td class="rowhead">' +
        (r.first ? '<span class="q">' + r.q + '</span><br>' : '') +
        '<span class="v">' + r.v + '</span></td>'
      for (const b of D.bands) {
        const c = byK.get(r.q + '|' + b + '|' + r.v)
        if (!c) {
          h += '<td class="cell"><span class="cellbox s-empty">' +
               '<span class="val">\\u2014</span>' +
               '<span class="sub2">not run</span></span></td>'
          continue
        }
        const v = c[m]
        const to = v == null && c.f > 0
        const other = m === 'p50' ? 'max ' + fmt(c.max) : 'p50 ' + fmt(c.p50)
        h += '<td class="cell"><button type="button" class="cellbox ' +
             (to ? 's-past' : sev(v)) + '" data-k="' + c.k + '">' +
             '<span class="val">' + (to ? 'timeout' : fmt(v)) +
             (c.f ? '<span class="fmark">' + c.f + '</span>' : '') +
             '</span><span class="sub2">' +
             (to ? c.f + '/' + c.it + ' failed' : other) +
             '</span></button></td>'
      }
      h += '</tr>'
    }
    t.innerHTML = h + '</tbody>'
  }
  const esc = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  const show = (el) => {
    const c = byK.get(el.dataset.k)
    if (!c) return
    const [q, , v] = c.k.split('|')
    const rs = [['cold', fmt(c.cold)], ['warm p50', fmt(c.p50)],
                ['warm max', fmt(c.max)],
                ['warm samples', c.n + ' of ' + (c.it - 1)],
                ['failed runs', c.f + ' of ' + c.it]]
    const desc = (name, text) =>
      text ? '<span class="d"><b>' + esc(name) + '</b> ' + esc(text) +
             '</span>' : ''
    tip.innerHTML = '<span class="tt">' + esc(c.k.split('|').join(':')) +
      '</span>' +
      desc(q, D.qDesc[q]) + desc(v, D.vDesc[v]) +
      rs.map((x) => '<span class="r"><span>' + x[0] + '</span><span>' +
        x[1] + '</span></span>').join('') +
      (c.e ? '<span class="e">' + esc(c.e) + '</span>' : '')
    tip.classList.add('on')
    const b = el.getBoundingClientRect(), tb = tip.getBoundingClientRect()
    let x = b.left + b.width / 2 - tb.width / 2
    x = Math.max(8, Math.min(x, innerWidth - tb.width - 8))
    let y = b.top - tb.height - 8
    if (y < 8) y = b.bottom + 8
    tip.style.left = x + 'px'
    tip.style.top = y + 'px'
  }
  const hide = () => tip.classList.remove('on')
  t.addEventListener('pointerover', (e) => {
    const el = e.target.closest('.cellbox[data-k]')
    if (el) show(el)
  })
  t.addEventListener('pointerout', hide)
  t.addEventListener('focusin', (e) => {
    const el = e.target.closest('.cellbox[data-k]')
    if (el) show(el)
  })
  t.addEventListener('focusout', hide)
  addEventListener('scroll', hide, { passive: true })
  document.querySelectorAll('.seg button').forEach((b) => {
    b.addEventListener('click', () => {
      m = b.dataset.m
      document.querySelectorAll('.seg button').forEach((o) =>
        o.setAttribute('aria-pressed', String(o === b)))
      hide()
      render()
    })
  })
  render()
})()
</script>`

  return page(
    data,
    prov,
    {
      title: 'Results',
      body: '<div class="scroller"><table class="matrix" id="matrix"></table></div>',
      controls,
    },
    { bands, extra, script },
  )
}

// Load mode is a different table (scenario x concurrency, not query x cohort)
// but the same page. Rendered server-side: there is no second metric to toggle.
const buildLoadHtml = (data: LoadArtifactData): string => {
  const levels = [
    ...new Set(data.results.flatMap((s) => s.levels.map((l) => l.concurrency))),
  ].sort((a, b) => a - b)

  const prov: [string, string][] = [
    ['Mode', data.mode],
    ['Environment', data.env],
    ['Commit', data.gitSha],
    ['Recorded', data.startedAt],
    ['Scenarios', String(data.results.length)],
    ['Failed gate', String(data.results.filter((s) => !s.passed).length)],
    ['Id-set size', data.idSet ? String(data.idSet.size) : 'n/a'],
    ['Id-set seed', data.idSet ? data.idSet.seed : 'n/a'],
  ]

  const rows = data.results.map((s) => [
    `<span class="mono">${esc(s.id)}</span>`,
    s.passed
      ? '<span class="mono">pass</span>'
      : '<span class="bad">FAIL</span>',
    ...levels.map((c) => {
      const lv = s.levels.find((l) => l.concurrency === c)
      if (!lv) return '<span class="mono">&#8212;</span>'
      const cls =
        lv.errorRate > 0 ? 's-past' : lv.max >= 20000 ? 's-ceil' : 's-ok'
      return (
        `<span class="loadcell ${cls}"><span class="val">` +
        `${Math.round(lv.p50)}/${Math.round(lv.max)}</span>` +
        `<span class="sub2">${Math.round(lv.errorRate * 100)}% err</span>` +
        '</span>'
      )
    }),
  ])

  const legend =
    '<div class="legend">' +
    '<span class="lg"><span class="sw" style="background:var(--ok)">' +
    '</span>no errors</span>' +
    '<span class="lg"><span class="sw" style="background:var(--ceil)">' +
    '</span>max at or past 20s</span>' +
    '<span class="lg"><span class="sw" style="background:var(--past)">' +
    '</span>errors at this concurrency</span></div>'

  return page(data, prov, {
    title: 'Concurrency sweep',
    controls: legend,
    body:
      dtable(['Scenario', 'Gate', ...levels.map((c) => `c=${c}`)], rows, [
        'k',
        'num',
      ]) +
      '<div class="notes"><p>Cells are <code>p50/max</code> in ms over the ' +
      'requests issued at that concurrency, with the share that errored ' +
      "beneath. The gate column is the scenario's own error-rate budget, " +
      'not a latency threshold.</p></div>',
  })
}

const isLoad = (d: ArtifactData | LoadArtifactData): d is LoadArtifactData =>
  d.mode === 'load'

export const buildArtifactHtml = (
  data: ArtifactData | LoadArtifactData,
): string => (isLoad(data) ? buildLoadHtml(data) : buildLatencyHtml(data))
