import { describe, expect, it } from 'vitest'
import {
  buildTestList,
  checkQuarantine,
  findProbationSpecs,
  isExpired,
  QuarantineEntry,
  renderRetries,
} from './e2e-lanes'

const entry = (overrides: Partial<QuarantineEntry> = {}): QuarantineEntry => ({
  spec: 'app/polls/polls-onboarding.spec.ts',
  ticket: 'ENG-11318',
  owner: 'swain',
  reason: 'Red on the train since the SMS cutoff',
  added: '2026-10-16',
  expires: '2026-10-23',
  ...overrides,
})

const exists = () => true

describe('checkQuarantine', () => {
  it('accepts an empty list', () => {
    expect(checkQuarantine([], exists)).toEqual({ entries: [], errors: [] })
  })

  it('accepts a whole-file entry and a test-level entry', () => {
    const raw = [
      entry(),
      entry({
        spec: 'app/dashboard/outreach/outreach-hub.spec.ts',
        test: 'outreach hub — sms tile upgrade-at-entry › non-Pro, gate v2 off: Text tile redirects straight to pro-upgrade',
        ticket: 'https://app.clickup.com/t/17tnw2b6nh7',
      }),
    ]

    expect(checkQuarantine(raw, exists).errors).toEqual([])
  })

  it.each([
    ['a missing owner', { owner: undefined }],
    ['an unknown key', { note: 'extra' }],
    ['a ticket that is neither an ENG id nor ClickUp', { ticket: 'JIRA-1' }],
    ['an impossible date', { expires: '2026-02-30' }],
    ['an expiry before the added date', { expires: '2026-10-15' }],
    ['an expiry more than 14 days out', { expires: '2026-11-15' }],
    ['a spec path under tests/', { spec: 'tests/app/polls/polls.spec.ts' }],
    ['a spec that is not a .spec.ts', { spec: 'app/polls/helpers.ts' }],
    ['a test title with an empty segment', { test: 'polls ›  › onboarding' }],
    ['a padded test title', { test: ' polls onboarding' }],
  ])('rejects %s', (_label, overrides) => {
    const { errors } = checkQuarantine([{ ...entry(), ...overrides }], exists)

    expect(errors.length).toBeGreaterThan(0)
  })

  it('rejects a spec that does not exist', () => {
    const { errors } = checkQuarantine([entry()], () => false)

    expect(errors).toEqual([
      '[0.spec] app/polls/polls-onboarding.spec.ts does not exist under tests/',
    ])
  })

  it('rejects duplicates and test entries a whole-file entry already covers', () => {
    const { errors } = checkQuarantine(
      [entry(), entry(), entry({ test: 'polls › onboarding' })],
      exists,
    )

    expect(errors).toEqual([
      '[1] duplicate entry for app/polls/polls-onboarding.spec.ts',
      '[2] app/polls/polls-onboarding.spec.ts › polls › onboarding is already covered by a whole-file entry for app/polls/polls-onboarding.spec.ts',
    ])
  })

  it('does not treat an expired entry as malformed', () => {
    const { errors, entries } = checkQuarantine([entry()], exists)

    expect(errors).toEqual([])
    expect(isExpired(entries[0]!, '2026-10-24')).toBe(true)
    expect(isExpired(entries[0]!, '2026-10-23')).toBe(false)
  })
})

describe('buildTestList', () => {
  it('lists whole files first, then single tests, as Playwright test-list lines', () => {
    const lines = buildTestList(
      [
        entry({ spec: 'app/b.spec.ts', test: 'b › one' }),
        entry({ spec: 'app/a.spec.ts' }),
      ],
      ['app/new.spec.ts'],
    )

    expect(lines).toEqual([
      'app/a.spec.ts',
      'app/new.spec.ts',
      'app/b.spec.ts › b › one',
    ])
  })

  it('drops a single test whose file is on probation', () => {
    const lines = buildTestList(
      [entry({ spec: 'app/new.spec.ts', test: 'new › one' })],
      ['app/new.spec.ts'],
    )

    expect(lines).toEqual(['app/new.spec.ts'])
  })

  it('is empty when nothing is quarantined or new', () => {
    expect(buildTestList([], [])).toEqual([])
  })
})

describe('findProbationSpecs', () => {
  it('finds specs that did not exist at the base commit', () => {
    const base = new Map([['app/old.spec.ts', 'aaa']])
    const head = new Map([
      ['app/old.spec.ts', 'aaa-edited'],
      ['app/new.spec.ts', 'bbb'],
    ])

    expect(findProbationSpecs(head, base)).toEqual(['app/new.spec.ts'])
  })

  it('does not put a spec on probation for being moved unchanged', () => {
    const base = new Map([['app/old/place.spec.ts', 'aaa']])
    const head = new Map([['app/new/place.spec.ts', 'aaa']])

    expect(findProbationSpecs(head, base)).toEqual([])
  })
})

describe('renderRetries', () => {
  const results = {
    suites: [
      {
        title: 'app/outreach.spec.ts',
        specs: [
          {
            title: 'top-level test',
            tests: [{ status: 'expected', results: [{ status: 'passed' }] }],
          },
        ],
        suites: [
          {
            title: 'outreach hub',
            specs: [
              {
                title: 'social tile',
                tests: [
                  {
                    status: 'flaky',
                    results: [
                      { status: 'failed' },
                      { status: 'timedOut' },
                      { status: 'passed' },
                    ],
                  },
                ],
              },
              {
                title: 'text tile',
                tests: [
                  {
                    status: 'unexpected',
                    results: [{ status: 'failed' }, { status: 'failed' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }

  it('lists only tests that failed an attempt and then passed, with counts', () => {
    expect(renderRetries(results)).toBe(
      [
        '**Passed only on retry (1 tests, 2 failed attempts):**',
        '',
        '- `app/outreach.spec.ts › outreach hub › social tile`: failed 2, passed on attempt 3',
        '',
      ].join('\n'),
    )
  })

  it('says none when every test passed first time', () => {
    expect(renderRetries({ suites: [] })).toBe(
      '**Passed only on retry:** none\n',
    )
  })
})
