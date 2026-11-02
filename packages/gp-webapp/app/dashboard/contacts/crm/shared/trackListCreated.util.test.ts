import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { trackListCreated } from './trackListCreated.util'

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

describe('trackListCreated', () => {
  beforeEach(() => vi.mocked(trackEvent).mockClear())

  it('fires the Win event with the list, its source and any extra keys', () => {
    trackListCreated({
      isServe: false,
      source: 'outreachBuilder',
      listId: 42,
      channel: 'sms',
    })
    // The audience hook's `sms` reads as the outreach events' `text`.
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.VoterData.ListCreated, {
      source: 'outreachBuilder',
      listId: 42,
      medium: 'text',
    })
  })

  it('fires the Serve event for an elected official', () => {
    trackListCreated({ isServe: true, source: 'civicPanel', listId: 7 })
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ConstituentData.ListCreated,
      { source: 'civicPanel', listId: 7 },
    )
  })

  it('omits medium when the list was not made inside a channel', () => {
    trackListCreated({ isServe: false, source: 'duplicate', listId: 3 })
    expect(vi.mocked(trackEvent).mock.calls[0]?.[1]).not.toHaveProperty(
      'medium',
    )
  })
})

// Campaign success counts voter lists off this one event, so a list saved
// anywhere without it disappears from the count (DATA-2307: two in three
// hand-built Win lists were missing). Any file that saves a voter list must
// also record it; a file with a real reason not to goes in EXEMPT with why.
const APP_ROOT = join(__dirname, '../../../..')
const CREATE_CALL = "'POST /v1/voters/voter-file/filter'"
const EXEMPT: Record<string, string> = {}

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : []
  })

describe('every voter-list save records List Created', () => {
  const savers = sourceFiles(APP_ROOT).filter((path) =>
    readFileSync(path, 'utf8').includes(CREATE_CALL),
  )

  it('finds the save sites', () => {
    // Guards the scan itself: a moved root would pass every check below.
    expect(savers.length).toBeGreaterThanOrEqual(8)
  })

  it.each(savers.map((path) => relative(APP_ROOT, path)))(
    '%s calls trackListCreated',
    (path) => {
      if (EXEMPT[path]) return
      expect(readFileSync(join(APP_ROOT, path), 'utf8')).toContain(
        'trackListCreated(',
      )
    },
  )
})
