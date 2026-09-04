import { describe, expect, it } from 'vitest'
import {
  findCohortSegment,
  findMissingAccounts,
  mergeCohortIntoSegments,
  parseArgs,
  parseEmails,
  parseResponseBody,
  type FlagSegment,
} from './amplitude-flag-cohort'
import type { UserEmailLookup } from './amplitude-flag-cohort'

const stubPrisma = (emails: (string | null)[]): UserEmailLookup => ({
  user: { findMany: async () => emails.map((email) => ({ email })) },
})

describe('parseResponseBody', () => {
  // Amplitude answers a successful PATCH with this, and parsing it as JSON
  // threw *after* the write had landed — a real run reported as a failure.
  it('tolerates the bare "ok" a successful write returns', () => {
    expect(parseResponseBody('ok')).toBeUndefined()
  })

  it('tolerates an empty body', () => {
    expect(parseResponseBody('')).toBeUndefined()
  })

  it('still parses JSON', () => {
    expect(parseResponseBody('{"flags":[]}')).toEqual({ flags: [] })
  })
})

const emailSegment = (name: string, values: string[]): FlagSegment => ({
  name,
  conditions: [{ type: 'property', prop: 'gp:email', op: 'is', values }],
  percentage: 100,
  rolloutWeights: { on: 1 },
})

describe('parseEmails', () => {
  it('reads one address per line', () => {
    expect(parseEmails('a@example.com\nb@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
    ])
  })

  it('lowercases, because Amplitude matches the property exactly', () => {
    expect(parseEmails('Jane@Example.COM')).toEqual(['jane@example.com'])
  })

  it('pulls the address out of a "Name <addr>" line', () => {
    expect(parseEmails('Shawna Girgis <smgirgis@comcast.net>')).toEqual([
      'smgirgis@comcast.net',
    ])
  })

  it('ignores comments and blank lines', () => {
    expect(parseEmails('# batch 2\n\na@example.com  # new\n')).toEqual([
      'a@example.com',
    ])
  })

  it('dedupes, including across casing', () => {
    expect(parseEmails('a@example.com\nA@example.com')).toEqual([
      'a@example.com',
    ])
  })

  it('strips a trailing period from a bare address', () => {
    expect(parseEmails('user@example.com.')).toEqual(['user@example.com'])
  })
})

describe('mergeCohortIntoSegments', () => {
  it('creates the segment when the flag has none', () => {
    const result = mergeCohortIntoSegments([], {
      segmentName: 'Pilot allowlist',
      variant: 'on',
      emails: ['a@example.com'],
    })

    expect(result.createdSegment).toBe(true)
    expect(result.segments).toHaveLength(1)
    expect(result.segments[0]).toMatchObject({
      name: 'Pilot allowlist',
      percentage: 100,
      rolloutWeights: { on: 1 },
      conditions: [
        {
          type: 'property',
          prop: 'gp:email',
          op: 'is',
          values: ['a@example.com'],
        },
      ],
    })
  })

  // The whole reason this script exists: PATCH replaces the segment array, so
  // an unrelated segment dropped here is a targeting rule deleted in prod.
  it('sends unrelated segments back untouched', () => {
    const other = emailSegment('Internal staff', ['staff@goodparty.org'])

    const result = mergeCohortIntoSegments([other], {
      segmentName: 'Pilot allowlist',
      variant: 'on',
      emails: ['a@example.com'],
    })

    expect(result.segments).toHaveLength(2)
    expect(result.segments[0]).toBe(other)
  })

  it('unions into an existing segment without dropping its members', () => {
    const result = mergeCohortIntoSegments(
      [emailSegment('Pilot allowlist', ['old@example.com'])],
      {
        segmentName: 'Pilot allowlist',
        variant: 'on',
        emails: ['new@example.com'],
      },
    )

    expect(result.createdSegment).toBe(false)
    expect(result.added).toEqual(['new@example.com'])
    expect(result.segments[0].conditions[0].values).toEqual([
      'old@example.com',
      'new@example.com',
    ])
  })

  // Amplitude's `is` operator is exact-match, so a mixed-case address added
  // through the UI would never match the address the app sends.
  it('lowercases addresses the segment already held', () => {
    const result = mergeCohortIntoSegments(
      [emailSegment('Pilot allowlist', ['Old@Example.com'])],
      {
        segmentName: 'Pilot allowlist',
        variant: 'on',
        emails: ['new@example.com'],
      },
    )

    expect(result.segments[0].conditions[0].values).toEqual([
      'old@example.com',
      'new@example.com',
    ])
  })

  it('refuses when the segment serves a different variant', () => {
    expect(() =>
      mergeCohortIntoSegments(
        [emailSegment('Pilot allowlist', ['old@example.com'])],
        {
          segmentName: 'Pilot allowlist',
          variant: 'off',
          emails: ['new@example.com'],
        },
      ),
    ).toThrow('serves "on", not "off"')
  })

  it('refuses when the segment resolves to no variant at all', () => {
    expect(() =>
      mergeCohortIntoSegments(
        [
          {
            ...emailSegment('Pilot allowlist', ['old@example.com']),
            rolloutWeights: {},
          },
        ],
        {
          segmentName: 'Pilot allowlist',
          variant: 'on',
          emails: ['new@example.com'],
        },
      ),
    ).toThrow('serves no variant, not "on"')
  })

  it('refuses when the requested variant carries a zero weight', () => {
    expect(() =>
      mergeCohortIntoSegments(
        [
          {
            ...emailSegment('Pilot allowlist', ['old@example.com']),
            rolloutWeights: { on: 0, off: 1 },
          },
        ],
        {
          segmentName: 'Pilot allowlist',
          variant: 'on',
          emails: ['new@example.com'],
        },
      ),
    ).toThrow('serves "off", not "on"')
  })

  it('merges into a segment that carries no rolloutWeights', () => {
    const segment = emailSegment('Pilot allowlist', ['old@example.com'])
    delete segment.rolloutWeights

    const result = mergeCohortIntoSegments([segment], {
      segmentName: 'Pilot allowlist',
      variant: 'on',
      emails: ['new@example.com'],
    })

    expect(result.added).toEqual(['new@example.com'])
  })

  // Re-running the same batch is the expected way to confirm a write landed.
  it('is idempotent', () => {
    const result = mergeCohortIntoSegments(
      [emailSegment('Pilot allowlist', ['a@example.com'])],
      {
        segmentName: 'Pilot allowlist',
        variant: 'on',
        emails: ['a@example.com'],
      },
    )

    expect(result.added).toEqual([])
    expect(result.alreadyPresent).toEqual(['a@example.com'])
    expect(result.segments[0].conditions[0].values).toEqual(['a@example.com'])
  })

  it('preserves other conditions on the segment it edits', () => {
    const segment: FlagSegment = {
      name: 'Pilot allowlist',
      conditions: [
        { type: 'property', prop: 'gp:email', op: 'is', values: [] },
        { type: 'property', prop: 'country', op: 'is', values: ['US'] },
      ],
      percentage: 100,
      rolloutWeights: { on: 1 },
    }

    const result = mergeCohortIntoSegments([segment], {
      segmentName: 'Pilot allowlist',
      variant: 'on',
      emails: ['a@example.com'],
    })

    expect(result.segments[0].conditions[1]).toEqual(segment.conditions[1])
  })

  it('refuses a same-named segment it does not know how to merge into', () => {
    const segment: FlagSegment = {
      name: 'Pilot allowlist',
      conditions: [
        { type: 'property', prop: 'country', op: 'is', values: ['US'] },
      ],
      percentage: 100,
    }

    expect(() =>
      mergeCohortIntoSegments([segment], {
        segmentName: 'Pilot allowlist',
        variant: 'on',
        emails: ['a@example.com'],
      }),
    ).toThrow(/no gp:email "is" condition/)
  })
})

describe('findCohortSegment', () => {
  // targetSegments cannot express a cohort, so round-tripping one deletes it.
  it('spots a cohort-backed segment', () => {
    const segment = {
      name: 'Beta cohort',
      conditions: [
        { type: 'cohort', prop: 'cohort', op: 'is', values: ['abc123'] },
      ],
      percentage: 100,
    }

    expect(findCohortSegment([segment])?.name).toBe('Beta cohort')
  })

  it('passes property-only segments', () => {
    expect(
      findCohortSegment([emailSegment('Pilot allowlist', [])]),
    ).toBeUndefined()
  })
})

describe('parseArgs', () => {
  const required = ['--flag', 'my-flag', '--emails-file', 'cohort.txt']

  it('defaults the segment and variant', () => {
    const args = parseArgs(required)

    expect(args.variant).toBe('on')
    expect(args.segment).toBe('Pilot allowlist')
    expect(args.execute).toBe(false)
  })

  it('rejects a value flag whose value is the next flag', () => {
    expect(() => parseArgs([...required, '--variant', '--execute'])).toThrow(
      '--variant requires a value.',
    )
  })

  it('rejects a value flag at the end of the line', () => {
    expect(() => parseArgs([...required, '--segment'])).toThrow(
      '--segment requires a value.',
    )
  })
})

describe('findMissingAccounts', () => {
  it('matches accounts regardless of the casing the database holds', async () => {
    const missing = await findMissingAccounts(
      ['a@example.com', 'b@example.com'],
      stubPrisma(['A@Example.com']),
    )

    expect(missing).toEqual(['b@example.com'])
  })

  it('reports every address when nothing matches', async () => {
    const missing = await findMissingAccounts(
      ['a@example.com'],
      stubPrisma([null]),
    )

    expect(missing).toEqual(['a@example.com'])
  })
})
