import { describe, it, expect } from 'vitest'
import {
  buildArtifactHtml,
  type ArtifactCase,
  type ArtifactData,
  type LoadArtifactData,
} from './artifactHtml'

const mkCase = (over: Partial<ArtifactCase> = {}): ArtifactCase => ({
  id: 'count:small:none',
  queryType: 'count',
  band: 'small',
  variant: 'none',
  iterations: 8,
  failures: 0,
  errors: [],
  cold: 4897,
  warm: { count: 7, p50: 640, max: 735 },
  ...over,
})

const data = (over: Partial<ArtifactData> = {}): ArtifactData => ({
  env: 'prod',
  mode: 'latency',
  gitSha: 'abc1234',
  startedAt: '2026-08-20T16:16:59.219Z',
  idSet: { size: 5000, seed: 'people-db-bench-v1' },
  descriptions: {
    queries: { count: 'The count behind a single tile.' },
    variants: {
      none: 'No filter at all: the whole district.',
      'outreach-exclude': 'Everyone except the people already contacted.',
    },
    bands: {
      small: {
        district: 'A WARD, CA',
        partition: 'CA (429M rows / 63GB)',
        description: 'A single village ward.',
      },
    },
  },
  results: [mkCase()],
  ...over,
})

describe('buildArtifactHtml', () => {
  it('is deterministic for the same input', () => {
    expect(buildArtifactHtml(data())).toBe(buildArtifactHtml(data()))
  })

  it('renders every description carried in the JSON', () => {
    const html = buildArtifactHtml(data())
    expect(html).toContain('The count behind a single tile.')
    expect(html).toContain('No filter at all: the whole district.')
    expect(html).toContain('A single village ward.')
    expect(html).toContain('CA (429M rows / 63GB)')
  })

  it('emits the fixed section order regardless of what the run found', () => {
    const sections = (html: string) =>
      [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1])
    expect(sections(buildArtifactHtml(data()))).toEqual([
      'Results',
      'Failures',
      'Cohorts',
      'Query types',
      'Filter variants',
      'How to read this',
    ])
    // A run with failures must not reorder or add sections.
    const withFailure = buildArtifactHtml(
      data({ results: [mkCase({ failures: 3, cold: null })] }),
    )
    expect(sections(withFailure)).toEqual(sections(buildArtifactHtml(data())))
  })

  it('carries the id-set provenance so a set size is never guessed at', () => {
    expect(buildArtifactHtml(data())).toContain('people-db-bench-v1')
    expect(buildArtifactHtml(data())).toContain('5000')
  })

  it('is pure ASCII so it cannot render as mojibake', () => {
    const html = buildArtifactHtml(
      data({
        descriptions: {
          variants: { none: 'an em dash — and a middot ·' },
        },
      }),
    )
    expect(/[^\x00-\x7f]/.test(html)).toBe(false)
    expect(html).toContain('&#8212;')
  })

  it('escapes a description rather than letting it inject markup', () => {
    const html = buildArtifactHtml(
      data({
        descriptions: { variants: { none: '<script>alert(1)</script>' } },
      }),
    )
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('reports the failure count and its error text', () => {
    const html = buildArtifactHtml(
      data({
        results: [
          mkCase({
            failures: 7,
            cold: null,
            errors: ['The voter query took too long to run.'],
          }),
        ],
      }),
    )
    expect(html).toContain('7 / 8')
    expect(html).toContain('The voter query took too long to run.')
  })

  it('says so plainly when nothing failed', () => {
    expect(buildArtifactHtml(data())).toContain('No cell recorded a failure.')
  })

  it('renders load mode as a concurrency sweep, not an empty matrix', () => {
    const load: LoadArtifactData = {
      env: 'prod',
      mode: 'load',
      gitSha: 'abc1234',
      startedAt: '2026-08-20T16:16:59.219Z',
      descriptions: data().descriptions,
      results: [
        {
          id: 'load:count:mega',
          passed: false,
          levels: [
            {
              concurrency: 50,
              p50: 1700,
              p95: 2400,
              max: 26000,
              errorRate: 0.12,
              throughputPerSec: 4,
              errors: ['timeout'],
            },
          ],
        },
      ],
    }
    const html = buildArtifactHtml(load)
    expect(html).toContain('Concurrency sweep')
    expect(html).toContain('c=50')
    expect(html).toContain('12% err')
    expect(html).toContain('FAIL')
    // the description tables are shared with latency mode
    expect(html).toContain('No filter at all: the whole district.')
  })

  it('ships the query and variant descriptions to the cell hover', () => {
    const html = buildArtifactHtml(data())
    // Both axes travel in the payload: a cell is a query x variant pair, so
    // naming one without the other leaves half the cell unexplained.
    expect(html).toContain('"qDesc"')
    expect(html).toContain('"vDesc"')
    expect(html).toContain('D.qDesc[q]')
    expect(html).toContain('D.vDesc[v]')
  })

  it('neutralizes a closing script tag inside the payload', () => {
    const html = buildArtifactHtml(
      data({
        results: [
          mkCase({ failures: 1, errors: ['boom </script><script>evil()'] }),
        ],
      }),
    )
    const payload = html.slice(
      html.indexOf('id="d">'),
      html.indexOf('</script>', html.indexOf('id="d">')),
    )
    // An unescaped '<' would close the tag early and spill the rest of the
    // JSON into the document.
    expect(payload).not.toContain('</script>')
    expect(payload).toContain('\\u003c')
  })

  it('keeps the theme tokens defined outside any media query', () => {
    const html = buildArtifactHtml(data())
    // A color whose only definition sits behind a media query renders one
    // theme's text on the other theme's ground.
    const root = html.slice(html.indexOf(':root{'), html.indexOf('@media'))
    for (const token of ['--ground', '--ink', '--ok', '--past']) {
      expect(root).toContain(token)
    }
  })
})
