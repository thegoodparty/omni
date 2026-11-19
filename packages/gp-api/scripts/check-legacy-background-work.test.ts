import { describe, expect, it } from 'vitest'
import {
  countScheduledJobs,
  findProblems,
  INBOX_QUEUE_TYPES,
  parseQueueTypes,
} from './check-legacy-background-work'

describe('parseQueueTypes', () => {
  it('reads enum values and skips comments', () => {
    const source = [
      'export enum QueueType {',
      "  FOO = 'foo',",
      "  // BAR = 'bar'",
      "  BAZ_2 = 'baz2',",
      '}',
    ].join('\n')

    expect(parseQueueTypes(source)).toEqual(['foo', 'baz2'])
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
  it('passes with only inbox types and no scheduled jobs', () => {
    expect(findProblems(INBOX_QUEUE_TYPES, {})).toEqual([])
  })

  it('passes when an inbox type is removed', () => {
    expect(findProblems(INBOX_QUEUE_TYPES.slice(1), {})).toEqual([])
  })

  it('fails on a queue type outside the inbox', () => {
    expect(findProblems([...INBOX_QUEUE_TYPES, 'newThing'], {})).toEqual([
      expect.stringContaining('QueueType newThing is not a message'),
    ])
  })

  it('fails on any @Cron or @Interval', () => {
    expect(
      findProblems(INBOX_QUEUE_TYPES, { 'src/new/new.service.ts': 1 }),
    ).toEqual([
      expect.stringContaining('src/new/new.service.ts has 1 @Cron/@Interval'),
    ])
  })
})
