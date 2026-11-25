import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseISO } from 'date-fns'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIVE_COMMAND, main, type CliIo } from './cli'
import { loadFixtures } from './fixtures'
import { renderReport } from './report'
import { buildResults, BenchResultsSchema } from './results'
import { runBench } from './runner'
import { labelEchoModel } from './stubs'

// The live model is never built here: liveModel throws if anything asks
// for it.
const NOW = parseISO('2026-11-10T06:00:00Z')

const capture = () => {
  const out: string[] = []
  const err: string[] = []
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    liveModel: () => {
      throw new Error('a live model was built')
    },
    now: () => NOW,
  }
  return { io, out, err }
}

const tempDir = () => mkdtempSync(path.join(tmpdir(), 'case-scout-bench-'))

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the bench CLI', () => {
  it('prints the estimate and refuses without --live or --stub', async () => {
    const dir = tempDir()
    const { io, out, err } = capture()

    expect(await main(['--out-dir', dir], io)).toBe(2)
    expect(out.join('\n')).toContain('estimated cost of a live run')
    expect(err.join('\n')).toContain(LIVE_COMMAND)
    expect(readdirSync(dir)).toEqual([])
  })

  it('needs an API key for --live', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const { io } = capture()

    expect(await main(['--live', '--out-dir', tempDir()], io)).toBe(2)
  })

  it('refuses --live and --stub together', async () => {
    const { io } = capture()

    expect(await main(['--live', '--stub', '--out-dir', tempDir()], io)).toBe(2)
  })

  it('writes a stub run and merges grades into it', async () => {
    const dir = tempDir()
    const { io } = capture()

    expect(await main(['--stub', '--out-dir', dir], io)).toBe(0)
    const [runId = ''] = readdirSync(dir)
    const runDir = path.join(dir, runId)
    const results = BenchResultsSchema.parse(
      JSON.parse(readFileSync(path.join(runDir, 'results.json'), 'utf8')),
    )
    expect(results.mode).toBe('stub')
    expect(results.summary.fixturesPassed).toBe(26)
    expect(readFileSync(path.join(runDir, 'report.html'), 'utf8')).toContain(
      'data-grade-for="f01-unsourced-turnout-math"',
    )

    const gradesPath = path.join(dir, 'grades.json')
    writeFileSync(
      gradesPath,
      JSON.stringify({
        runId: results.runId,
        grades: {
          'f01-unsourced-turnout-math': {
            faithful: 3,
            gradeable: 3,
            fictional: 3,
          },
        },
      }),
    )
    expect(await main(['--grade', runDir, gradesPath], io)).toBe(0)
    const merged = BenchResultsSchema.parse(
      JSON.parse(readFileSync(path.join(runDir, 'results.json'), 'utf8')),
    )
    expect(
      merged.fixtures.find((f) => f.id === 'f01-unsourced-turnout-math')
        ?.grades,
    ).toEqual({ faithful: 3, gradeable: 3, fictional: 3, note: '' })
    expect(merged.gradeSummary?.allThrees).toBe(1)
  })

  it.each([
    ['another run', { runId: 'another-run', grades: {} }],
    [
      'a grade out of range',
      {
        runId: 'RUN',
        grades: { 'f01-unsourced-turnout-math': { faithful: 4 } },
      },
    ],
    [
      'an unknown fixture',
      { runId: 'RUN', grades: { 'no-such-fixture': { faithful: 1 } } },
    ],
  ])('refuses grades for %s', async (_label, payload) => {
    const dir = tempDir()
    const { io } = capture()
    const run = await runBench({
      fixtures: loadFixtures(),
      model: labelEchoModel(loadFixtures()),
      now: NOW,
      runId: 'RUN',
    })
    writeFileSync(
      path.join(dir, 'results.json'),
      JSON.stringify(buildResults(run, 'stub', dir, NOW)),
    )
    const gradesPath = path.join(dir, 'grades.json')
    writeFileSync(gradesPath, JSON.stringify(payload))

    expect(await main(['--grade', dir, gradesPath], io)).toBe(1)
  })
})

describe('renderReport', () => {
  it('escapes content and offers grades only for drafts', async () => {
    const fixtures = loadFixtures()
    const run = await runBench({
      fixtures,
      model: labelEchoModel(fixtures),
      now: NOW,
      runId: 'RUN',
    })
    const results = buildResults(run, 'stub', 'bench-out/x', NOW)
    const [first] = results.fixtures
    if (!first) throw new Error('no fixtures')
    first.summary = '<script>alert(1)</script>'

    const html = renderReport(results)

    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html.split('data-grade-for=').length - 1).toBe(
      results.summary.drafts,
    )
    expect(html).toContain('Stub run')
  })
})
