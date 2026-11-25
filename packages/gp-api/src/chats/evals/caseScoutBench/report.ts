import type { BenchResults } from './results'
import type { Check, FixtureResult } from './runner'

// report.html: the human grading sheet for one bench run. A local file,
// opened in a browser, never published. Grades are exported as JSON from the
// page and merged into results.json with `--grade`.

export const GRADE_DIMENSIONS = [
  ['faithful', 'Faithful', 'The case tests the failure in the chat.'],
  [
    'gradeable',
    'Gradeable',
    'One judge could apply the handled-when rule the same way twice.',
  ],
  ['fictional', 'Fictional', 'No real person, office or place.'],
] as const

const STYLE = `
:root {
  --bg: #fafaf9; --panel: #ffffff; --text: #1c1917; --muted: #57534e; --line: #e7e5e4;
  --pass: #15803d; --fail: #b91c1c; --na: #78716c; --accent: #1d4ed8; --code: #f5f5f4;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1c1917; --panel: #292524; --text: #f5f5f4; --muted: #a8a29e; --line: #44403c;
    --pass: #4ade80; --fail: #f87171; --na: #a8a29e; --accent: #93c5fd; --code: #1c1917;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 0 0 8px; }
h3 { font-size: 14px; margin: 16px 0 6px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.muted { color: var(--muted); }
.banner { border: 1px solid var(--fail); color: var(--fail); padding: 8px 12px; border-radius: 6px; margin: 12px 0; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin: 16px 0; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
.table-wrap { overflow-x: auto; }
.pass { color: var(--pass); font-weight: 600; }
.fail { color: var(--fail); font-weight: 600; }
.na { color: var(--na); }
pre { background: var(--code); border: 1px solid var(--line); border-radius: 6px; padding: 10px; overflow-x: auto;
  white-space: pre-wrap; word-break: break-word; font-size: 13px; }
.grades { display: grid; gap: 10px; margin-top: 8px; }
.grade-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.grade-row strong { min-width: 90px; }
textarea { width: 100%; min-height: 48px; font: inherit; background: var(--bg); color: var(--text);
  border: 1px solid var(--line); border-radius: 6px; padding: 6px; }
button { font: inherit; padding: 8px 14px; border-radius: 6px; border: 1px solid var(--accent);
  background: var(--accent); color: var(--bg); cursor: pointer; }
a { color: var(--accent); }
`

const SCRIPT = `
(() => {
  const data = JSON.parse(document.getElementById('bench-data').textContent)
  const key = 'case-scout-bench:' + data.runId
  const dims = ['faithful', 'gradeable', 'fictional']
  let saved = {}
  try { saved = JSON.parse(localStorage.getItem(key) || '{}') } catch (e) { saved = {} }

  const collect = () => {
    const grades = {}
    document.querySelectorAll('[data-grade-for]').forEach((block) => {
      const id = block.getAttribute('data-grade-for')
      const entry = { note: block.querySelector('textarea').value }
      dims.forEach((dim) => {
        const picked = block.querySelector('input[name="' + id + ':' + dim + '"]:checked')
        entry[dim] = picked ? Number(picked.value) : null
      })
      grades[id] = entry
    })
    return grades
  }

  document.querySelectorAll('[data-grade-for]').forEach((block) => {
    const id = block.getAttribute('data-grade-for')
    const prior = saved[id]
    if (!prior) return
    dims.forEach((dim) => {
      const input = block.querySelector('input[name="' + id + ':' + dim + '"][value="' + prior[dim] + '"]')
      if (input) input.checked = true
    })
    if (typeof prior.note === 'string') block.querySelector('textarea').value = prior.note
  })

  const save = () => {
    try { localStorage.setItem(key, JSON.stringify(collect())) } catch (e) {}
  }
  document.addEventListener('change', save)
  document.addEventListener('input', save)

  document.getElementById('export-grades').addEventListener('click', () => {
    const body = JSON.stringify({ runId: data.runId, grades: collect() }, null, 2)
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }))
    link.download = 'grades-' + data.runId + '.json'
    link.click()
  })
})()
`

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
}

export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char)

const status = (value: Check['status']): string => {
  const css = value === 'pass' ? 'pass' : value === 'fail' ? 'fail' : 'na'
  return `<span class="${css}">${escapeHtml(value)}</span>`
}

const expected = (fixture: FixtureResult): string => {
  const { expect } = fixture
  if (!expect.scored) return 'ignored (scope not covered)'
  if (expect.covered_by) return `skipped, covered by ${expect.covered_by}`
  const cap =
    expect.max_severity !== null
      ? `, severity at most ${expect.max_severity}`
      : ''
  if (expect.should_draft) {
    const text = expect.pattern ? `draft (${expect.pattern})` : 'draft'
    return text + (expect.drop_ok ? ', or dropped' : '') + cap
  }
  return 'no draft' + cap
}

const summaryTable = (fixtures: FixtureResult[]): string => {
  const rows = fixtures.map((f) => {
    const failed = Object.entries(f.checks)
      .filter(([, c]) => c.status === 'fail')
      .map(([name]) => name)
    const id = escapeHtml(f.id)
    return (
      '<tr>' +
      `<td><a href="#${id}">${id}</a></td>` +
      `<td>${escapeHtml(f.agent)}</td>` +
      `<td>${escapeHtml(f.category)}</td>` +
      `<td>${escapeHtml(expected(f))}</td>` +
      `<td>${escapeHtml(f.outcome ?? '-')}</td>` +
      `<td>${escapeHtml(String(f.score?.severity ?? '-'))}</td>` +
      `<td>${status(f.passed ? 'pass' : 'fail')}` +
      `${failed.length > 0 ? ' ' + escapeHtml(failed.join(', ')) : ''}</td>` +
      '</tr>'
    )
  })
  return (
    '<div class="table-wrap"><table><thead><tr><th>Fixture</th>' +
    '<th>Agent</th><th>Category</th><th>Expected</th><th>Outcome</th>' +
    '<th>Severity</th><th>Checks</th></tr></thead><tbody>' +
    rows.join('') +
    '</tbody></table></div>'
  )
}

const gradeBlock = (fixture: FixtureResult): string => {
  const id = escapeHtml(fixture.id)
  const rows = GRADE_DIMENSIONS.map(([key, label, hint]) => {
    const options = [1, 2, 3]
      .map(
        (n) =>
          `<label><input type="radio" name="${id}:${key}" value="${n}"` +
          `${fixture.grades[key] === n ? ' checked' : ''}> ${n}</label>`,
      )
      .join('')
    return (
      `<div class="grade-row"><strong>${label}</strong>${options}` +
      `<span class="muted">${escapeHtml(hint)}</span></div>`
    )
  })
  return (
    `<h3>Your grade</h3><div class="grades" data-grade-for="${id}">` +
    rows.join('') +
    '<textarea placeholder="Note (optional)">' +
    `${escapeHtml(fixture.grades.note)}</textarea></div>`
  )
}

const fixtureCard = (fixture: FixtureResult): string => {
  const parts = [
    `<section class="panel" id="${escapeHtml(fixture.id)}">`,
    `<h2>${escapeHtml(fixture.id)}</h2>`,
    `<p class="muted">${escapeHtml(fixture.agent)} · ` +
      `${escapeHtml(fixture.category)} · ` +
      `expected: ${escapeHtml(expected(fixture))}</p>`,
    `<p>${escapeHtml(fixture.summary)}</p>`,
  ]
  if (fixture.notes) {
    parts.push(`<p class="muted">${escapeHtml(fixture.notes)}</p>`)
  }

  parts.push("<h3>Scout's score</h3>")
  if (fixture.score) {
    const rows = fixture.score.requests
      .map(
        (r) =>
          `<tr><td>${r.severity}</td><td>${escapeHtml(r.knownPattern)}</td>` +
          `<td>${escapeHtml(r.majorFailureType)}</td>` +
          `<td>${escapeHtml(r.summary)}</td>` +
          `<td>${escapeHtml(r.reason)}</td></tr>`,
      )
      .join('')
    parts.push(
      '<div class="table-wrap"><table><thead><tr><th>Severity</th>' +
        '<th>Pattern</th><th>Failure</th><th>Ask</th><th>Reason</th>' +
        `</tr></thead><tbody>${rows}</tbody></table></div>`,
    )
  } else {
    parts.push(
      `<p class="muted">${escapeHtml(fixture.scoringError ?? 'not scored')}</p>`,
    )
  }

  const draft = fixture.draftResponse
  parts.push('<h3>Drafting</h3>')
  if (draft) {
    parts.push(
      `<p>Outcome <strong>${escapeHtml(draft.outcome)}</strong>` +
        (draft.coveredBy
          ? `, covered by <code>${escapeHtml(draft.coveredBy)}</code>`
          : '') +
        (draft.needsSetup
          ? `, needs setup: ${escapeHtml(draft.needsSetup)}`
          : '') +
        '. <span class="muted">Failure summary: ' +
        `${escapeHtml(draft.failureSummary)}</span></p>`,
    )
    const shown = fixture.case ?? draft.case
    if (shown) {
      parts.push(`<pre>${escapeHtml(JSON.stringify(shown, null, 2))}</pre>`)
    }
  } else {
    parts.push('<p class="muted">Not drafted (not a candidate).</p>')
  }

  parts.push('<h3>Gate</h3>')
  const { gate } = fixture
  if (gate === null) {
    parts.push('<p class="muted">Not reached.</p>')
  } else if (gate.passed) {
    parts.push(`<p>${status('pass')}</p>`)
  } else {
    parts.push(
      `<p>${status('fail')} ${escapeHtml(String(gate.rule))}: ` +
        `${escapeHtml(String(gate.reason))}</p>`,
    )
    if (gate.flagged && gate.flagged.length > 0) {
      parts.push(
        `<p>Flagged: ${gate.flagged.map((item) => escapeHtml(item)).join('; ')}</p>`,
      )
    }
  }

  const checks = Object.entries(fixture.checks)
    .map(
      ([name, c]) =>
        `<tr><td>${escapeHtml(name)}</td><td>${status(c.status)}</td>` +
        `<td>${escapeHtml(c.detail)}</td></tr>`,
    )
    .join('')
  parts.push(
    '<h3>Automatic checks</h3><div class="table-wrap"><table><tbody>' +
      `${checks}</tbody></table></div>`,
  )

  if (fixture.case) parts.push(gradeBlock(fixture))
  parts.push('</section>')
  return parts.join('')
}

export const gradeCommand = (outDir: string, runId: string): string =>
  `npm run case-scout:bench -w packages/gp-api -- --grade ${outDir} ` +
  `~/Downloads/grades-${runId}.json`

export const renderReport = (results: BenchResults): string => {
  const { summary, cost } = results
  const data = JSON.stringify({ runId: results.runId }).replace(/<\//g, '<\\/')
  const banner =
    results.mode === 'stub'
      ? '<p class="banner">Stub run: every model answer came from the ' +
        'fixture labels. This checks the plumbing only and says nothing ' +
        "about the scout's quality.</p>"
      : ''
  const dims = GRADE_DIMENSIONS.map(
    ([, label, hint]) =>
      `<li><strong>${label}</strong>: ${escapeHtml(hint)}</li>`,
  ).join('')
  return (
    "<!doctype html><html lang='en'><head><meta charset='utf-8'>" +
    "<meta name='viewport' content='width=device-width, initial-scale=1'>" +
    `<title>Case scout bench</title><style>${STYLE}</style></head><body>` +
    '<main><h1>Case scout bench</h1>' +
    `<p class='muted'>Run ${escapeHtml(results.runId)} · ` +
    `${escapeHtml(results.mode)} · ${escapeHtml(cost.model)} · ` +
    `estimated $${cost.estimatedUsd.toFixed(2)}</p>` +
    banner +
    "<div class='panel'>" +
    `<p><strong>${summary.fixturesPassed} of ${summary.fixtures}</strong> ` +
    'fixtures passed every automatic check. ' +
    `${summary.drafts} drafts reached the bundle.</p>` +
    `${summaryTable(results.fixtures)}</div>` +
    "<div class='panel'><h2>Grading</h2><p>Grade every drafted case 1 to 3 " +
    'on each line. 3 is right, 2 is close, 1 is wrong.</p>' +
    `<ul>${dims}</ul>` +
    '<p>Your choices are kept in this browser while you work. When you ' +
    'finish, export them and merge them into results.json:</p>' +
    `<pre>${escapeHtml(gradeCommand(results.outDir, results.runId))}</pre>` +
    "<button id='export-grades' type='button'>Export grades</button></div>" +
    results.fixtures.map(fixtureCard).join('') +
    "<script type='application/json' id='bench-data'>" +
    `${data}</script><script>${SCRIPT}</script>` +
    '</main></body></html>'
  )
}
