import { describe, expect, it } from 'vitest'
import { getHistoryStatusLabel, type HistoryRow } from './historyStatus.util'

const p2pRow = (overrides: Partial<HistoryRow>): HistoryRow =>
  ({
    id: 1,
    outreachType: 'p2p',
    phoneListId: 7,
    ...overrides,
  }) as HistoryRow

describe('getHistoryStatusLabel', () => {
  it('labels a canceled p2p row even though its vendor job was deleted', () => {
    expect(getHistoryStatusLabel(p2pRow({ status: 'canceled' }))).toBe(
      'Canceled',
    )
  })

  it('still returns null for a non-canceled p2p row with no vendor job', () => {
    expect(getHistoryStatusLabel(p2pRow({ status: 'pending' }))).toBeNull()
  })
})

describe('getHistoryStatusLabel — scheduled paid rows', () => {
  it('labels a pending p2p row with a live vendor job Scheduled, not Draft', () => {
    expect(
      getHistoryStatusLabel(
        p2pRow({ status: 'pending', p2pJob: { status: 'paused' } }),
      ),
    ).toBe('Scheduled')
    expect(
      getHistoryStatusLabel(
        p2pRow({ status: 'pending', p2pJob: { status: 'pending' } }),
      ),
    ).toBe('Scheduled')
  })
})

describe('getHistoryStatusLabel — robocall', () => {
  const robocallRow = (overrides: Partial<HistoryRow>): HistoryRow =>
    ({
      id: 2,
      outreachType: 'robocall',
      phoneListId: null,
      ...overrides,
    }) as HistoryRow

  it('labels a pending robocall Scheduled, not In review', () => {
    expect(getHistoryStatusLabel(robocallRow({ status: 'pending' }))).toBe(
      'Scheduled',
    )
  })

  it('labels a canceled robocall Canceled', () => {
    expect(getHistoryStatusLabel(robocallRow({ status: 'canceled' }))).toBe(
      'Canceled',
    )
  })
})
