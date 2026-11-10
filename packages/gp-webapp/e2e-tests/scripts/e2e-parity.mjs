#!/usr/bin/env node
// Parity between two runs of the same Playwright suite: the preview-based E2E
// (the gate, gp-webapp.yml) and the local-build trial
// (gp-webapp-e2e-trial.yml). docs/testing.md § Local-build E2E trial.
//
//   node e2e-parity.mjs compare <preview.json> <local.json> <parity.json>
//     -> prints a Markdown summary, writes the per-test comparison as JSON
//   node e2e-parity.mjs aggregate <dir>
//     -> prints the cut-over numbers over every parity JSON under <dir>
//
// The inputs are merged JSON-reporter results. A missing or unreadable file
// is reported as "no results", never a crash: the trial must not go red.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const readJson = (path) => {
  if (!path) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

// Same key as plan-shards.mjs: file, describe titles, test title.
const outcomesOf = (report) => {
  const out = new Map()
  const walk = (suite, path) => {
    for (const spec of suite.specs ?? []) {
      const key = [spec.file, ...path, spec.title].join(' › ')
      const statuses = spec.tests.map((t) => t.status)
      const outcome = statuses.includes('unexpected')
        ? 'failed'
        : statuses.includes('flaky')
          ? 'flaky'
          : statuses.every((s) => s === 'skipped')
            ? 'skipped'
            : 'passed'
      out.set(key, outcome)
    }
    for (const child of suite.suites ?? []) walk(child, [...path, child.title])
  }
  for (const fileSuite of report?.suites ?? []) walk(fileSuite, [])
  return out
}

const passed = (o) => o === 'passed' || o === 'flaky'

const verdictOf = (preview, local) => {
  if (!preview) return 'local only'
  if (!local) return 'preview only'
  if (preview === 'skipped' || local === 'skipped') {
    return preview === local ? 'agree' : 'skipped in one'
  }
  return passed(preview) === passed(local) ? 'agree' : 'disagree'
}

const countsOf = (outcomes) => {
  const counts = { passed: 0, flaky: 0, failed: 0, skipped: 0 }
  for (const o of outcomes.values()) counts[o] += 1
  return counts
}

const minutes = (ms) =>
  ms ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : '-'

const LABEL = {
  passed: 'passed',
  flaky: 'passed on retry',
  failed: '**failed**',
  skipped: 'skipped',
}

const table = (rows) =>
  [
    '| Test | Preview | Local build |',
    '| --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| ${r.test.replaceAll('|', '\\|')} | ${LABEL[r.preview] ?? 'not run'} | ${LABEL[r.local] ?? 'not run'} |`,
    ),
  ].join('\n')

const compare = (previewPath, localPath, outPath) => {
  const previewReport = readJson(previewPath)
  const localReport = readJson(localPath)
  const preview = outcomesOf(previewReport)
  const local = outcomesOf(localReport)
  const tests = [...new Set([...preview.keys(), ...local.keys()])].sort()
  const rows = tests.map((test) => ({
    test,
    preview: preview.get(test) ?? null,
    local: local.get(test) ?? null,
    verdict: verdictOf(preview.get(test), local.get(test)),
  }))
  const compared = rows.filter(
    (r) => r.verdict === 'agree' || r.verdict === 'disagree',
  )
  const disagree = rows.filter((r) => r.verdict === 'disagree')
  const flakyInOne = rows.filter(
    (r) =>
      r.verdict === 'agree' &&
      (r.preview === 'flaky') !== (r.local === 'flaky'),
  )
  const unmatched = rows.filter(
    (r) => r.verdict !== 'agree' && r.verdict !== 'disagree',
  )
  const previewCounts = countsOf(preview)
  const localCounts = countsOf(local)

  const lines = []
  if (!previewReport || !localReport) {
    const missing = [
      !previewReport && 'the preview run',
      !localReport && 'the local build',
    ].filter(Boolean)
    lines.push(
      `No parity: no results from ${missing.join(' or ')}.`,
      '',
      'The preview E2E is unaffected; it is still the gate.',
    )
  } else {
    lines.push(
      disagree.length === 0
        ? `✅ The local build agrees with the preview on all ${compared.length} tests compared.`
        : `⚠️ The local build disagrees with the preview on ${disagree.length} of ${compared.length} tests compared.`,
      '',
      '| | Preview (gate) | Local build (trial) |',
      '| --- | --- | --- |',
      `| Passed first try | ${previewCounts.passed} | ${localCounts.passed} |`,
      `| Passed on retry | ${previewCounts.flaky} | ${localCounts.flaky} |`,
      `| Failed | ${previewCounts.failed} | ${localCounts.failed} |`,
      `| Skipped | ${previewCounts.skipped} | ${localCounts.skipped} |`,
      `| Run time | ${minutes(previewReport.stats?.duration)} | ${minutes(localReport.stats?.duration)} |`,
    )
    if (disagree.length) {
      lines.push('', '### Pass/fail differs', '', table(disagree))
    }
    if (flakyInOne.length) {
      lines.push(
        '',
        '### Needed a retry in one run only',
        '',
        table(flakyInOne),
      )
    }
    if (unmatched.length) {
      lines.push(
        '',
        `### Not compared (${unmatched.length})`,
        '',
        'Ran in one run only, or skipped in one. A whole shard missing shows up here.',
        '',
        table(unmatched),
      )
    }
    lines.push(
      '',
      `<details><summary>Every test (${rows.length})</summary>`,
      '',
      table(rows),
      '',
      '</details>',
    )
  }

  writeFileSync(
    outPath,
    JSON.stringify({
      compared: compared.length,
      disagree: disagree.length,
      preview: previewReport ? previewCounts : null,
      local: localReport ? localCounts : null,
      previewMs: previewReport?.stats?.duration ?? null,
      localMs: localReport?.stats?.duration ?? null,
      rows,
    }),
  )
  process.stdout.write(`${lines.join('\n')}\n`)
}

const parityFiles = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return parityFiles(path)
    return name.endsWith('.json') ? [path] : []
  })

const percent = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-')

const aggregate = (dir) => {
  const runs = parityFiles(dir)
    .map(readJson)
    .filter((p) => p?.preview && p?.local)
  const sum = (pick) => runs.reduce((n, p) => n + pick(p), 0)
  const tests = sum((p) => p.compared)
  const disagreements = sum((p) => p.disagree)
  const fullAgreement = runs.filter((p) => p.disagree === 0).length
  const flakyPreview = sum((p) => p.preview.flaky)
  const flakyLocal = sum((p) => p.local.flaky)
  const ranPreview = sum(
    (p) => p.preview.passed + p.preview.flaky + p.preview.failed,
  )
  const ranLocal = sum((p) => p.local.passed + p.local.flaky + p.local.failed)
  const byTest = new Map()
  for (const p of runs) {
    for (const r of p.rows.filter((row) => row.verdict === 'disagree')) {
      byTest.set(r.test, (byTest.get(r.test) ?? 0) + 1)
    }
  }
  const worst = [...byTest.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
  const lines = [
    `Runs with results from both: ${runs.length}`,
    `Runs where every test agreed: ${fullAgreement} (${percent(fullAgreement, runs.length)})`,
    `Tests compared: ${tests}, pass/fail differed: ${disagreements} (${percent(disagreements, tests)})`,
    `Passed on retry, preview: ${flakyPreview} of ${ranPreview} (${percent(flakyPreview, ranPreview)})`,
    `Passed on retry, local build: ${flakyLocal} of ${ranLocal} (${percent(flakyLocal, ranLocal)})`,
  ]
  if (worst.length) {
    lines.push('', 'Most frequent disagreements:')
    for (const [test, n] of worst) lines.push(`  ${n}x ${test}`)
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

const [mode, ...args] = process.argv.slice(2)
if (mode === 'compare') {
  compare(args[0], args[1], args[2])
} else if (mode === 'aggregate') {
  aggregate(args[0])
} else {
  console.error('usage: e2e-parity.mjs compare|aggregate ...')
  process.exit(2)
}
