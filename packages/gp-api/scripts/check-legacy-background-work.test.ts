import { describe, expect, it } from 'vitest'
import {
  countScheduledJobs,
  findProblems,
  parseQueueTypes,
  QUEUE_TYPES,
  SCHEDULED_JOBS,
} from './check-legacy-background-work'

describe('parseQueueTypes', () => {
  it('reads enum keys and skips comments', () => {
    const source = [
      'export enum QueueType {',
      "  FOO = 'foo',",
      '  // BAR = a comment',
      "  BAZ_2 = 'baz2',",
      '}',
    ].join('\n')

    expect(parseQueueTypes(source)).toEqual(['FOO', 'BAZ_2'])
  })
})

describe('countScheduledJobs', () => {
  it('counts @Cron and @Interval decorators, not @Timeout or prose', () => {
    const source = [
      "  @Cron('* * * * *')",
      '  @Interval(1000)',
      '  @Timeout(0)',
      "// grep -rn '@Cron(' before changing",
    ].join('\n')

    expect(countScheduledJobs(source)).toBe(2)
  })
})

describe('findProblems', () => {
  it('passes at the baseline', () => {
    expect(findProblems(QUEUE_TYPES, SCHEDULED_JOBS)).toEqual([])
  })

  it('fails on a new queue type', () => {
    const problems = findProblems([...QUEUE_TYPES, 'NEW_THING'], SCHEDULED_JOBS)

    expect(problems).toEqual([
      expect.stringContaining('New QueueType NEW_THING'),
    ])
  })

  it('fails on a removed queue type until the baseline drops it', () => {
    const problems = findProblems(QUEUE_TYPES.slice(1), SCHEDULED_JOBS)

    expect(problems).toEqual([
      expect.stringContaining(`QueueType ${QUEUE_TYPES[0]} is gone`),
    ])
  })

  it('fails on a new cron in a new file', () => {
    const problems = findProblems(QUEUE_TYPES, {
      ...SCHEDULED_JOBS,
      'src/new/new.service.ts': 1,
    })

    expect(problems).toEqual([
      expect.stringContaining(
        'src/new/new.service.ts has 1 @Cron/@Interval, baseline 0',
      ),
    ])
  })

  it('fails on a removed cron until the baseline is lowered', () => {
    const [file] = Object.keys(SCHEDULED_JOBS)
    const rest = Object.fromEntries(
      Object.entries(SCHEDULED_JOBS).filter(([key]) => key !== file),
    )

    expect(findProblems(QUEUE_TYPES, rest)).toEqual([
      expect.stringContaining('Lower SCHEDULED_JOBS'),
    ])
  })
})
