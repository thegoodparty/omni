import { describe, expect, it } from 'vitest'
import type { MembershipState } from 'app/dashboard/shared/membership/deriveMembershipState'
import { getHistoryStatusLabel, type HistoryRow } from './historyStatus.util'

const p2pRow = (overrides: Partial<HistoryRow>): HistoryRow =>
  ({
    id: 1,
    outreachType: 'p2p',
    phoneListId: 7,
    ...overrides,
  }) as HistoryRow

const membership = (
  overrides: Partial<MembershipState> = {},
): MembershipState => ({
  tier: 'pro',
  texting: 'needs_verification',
  pinDelivery: null,
  isElectedOffice: false,
  ...overrides,
})

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

describe('getHistoryStatusLabel — draft rows read the next step from membership', () => {
  const draftP2pRow = p2pRow({ status: 'draft', phoneListId: null })

  it("labels a free candidate's draft Pro needed", () => {
    expect(
      getHistoryStatusLabel(draftP2pRow, membership({ tier: 'free' })),
    ).toBe('Pro needed')
  })

  it('labels a Pro texting draft Verification needed before TCR is submitted', () => {
    expect(
      getHistoryStatusLabel(
        draftP2pRow,
        membership({ tier: 'pro', texting: 'needs_verification' }),
      ),
    ).toBe('Verification needed')
  })

  it('labels a Pro texting draft Verification in review once TCR is pending', () => {
    expect(
      getHistoryStatusLabel(
        draftP2pRow,
        membership({ tier: 'pro', texting: 'in_review' }),
      ),
    ).toBe('Verification in review')
  })

  it('labels a Pro texting draft PIN needed while the CV is awaiting a PIN', () => {
    expect(
      getHistoryStatusLabel(
        draftP2pRow,
        membership({ tier: 'pro', texting: 'awaiting_pin' }),
      ),
    ).toBe('PIN needed')
  })

  it('labels a Pro texting draft Ready to schedule once texting is cleared', () => {
    expect(
      getHistoryStatusLabel(
        draftP2pRow,
        membership({ tier: 'pro', texting: 'cleared' }),
      ),
    ).toBe('Ready to schedule')
  })

  it('labels a Pro robocall draft Ready to schedule regardless of texting state', () => {
    const draftRobocallRow = {
      id: 2,
      outreachType: 'robocall',
      status: 'draft',
    } as HistoryRow
    expect(
      getHistoryStatusLabel(
        draftRobocallRow,
        membership({ tier: 'pro', texting: 'needs_verification' }),
      ),
    ).toBe('Ready to schedule')
  })

  it('does not assume Pro needed when no membership is passed', () => {
    expect(getHistoryStatusLabel(draftP2pRow, null)).toBeNull()
    expect(getHistoryStatusLabel(draftP2pRow)).toBeNull()
  })
})

describe('getHistoryStatusLabel — active jobs follow their send window', () => {
  const day = 24 * 60 * 60 * 1000
  const isoDay = (offsetDays: number) =>
    new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10)

  it('labels an active job Scheduled while its window is in the future', () => {
    // The regression: CAS activates at approve, weeks before the send —
    // an activated-but-unstarted job must never read Done (2026-09-16).
    expect(
      getHistoryStatusLabel(
        p2pRow({
          status: 'in_progress',
          p2pJob: {
            status: 'active',
            start_date: isoDay(19),
            end_date: isoDay(19),
          },
        }),
      ),
    ).toBe('Scheduled')
  })

  it('labels an active job Sending inside its window', () => {
    expect(
      getHistoryStatusLabel(
        p2pRow({
          status: 'pending',
          p2pJob: {
            status: 'active',
            start_date: isoDay(-1),
            end_date: isoDay(1),
          },
        }),
      ),
    ).toBe('Sending')
  })

  it('labels an active job Done once its end day has fully passed', () => {
    expect(
      getHistoryStatusLabel(
        p2pRow({
          status: 'in_progress',
          p2pJob: {
            status: 'active',
            start_date: isoDay(-3),
            end_date: isoDay(-2),
          },
        }),
      ),
    ).toBe('Done')
  })

  it('falls back to Done for an active job with no window dates', () => {
    expect(
      getHistoryStatusLabel(
        p2pRow({ status: 'in_progress', p2pJob: { status: 'active' } }),
      ),
    ).toBe('Done')
  })
})

describe('getHistoryStatusLabel — send failures', () => {
  it("labels a failed robocall row Couldn't send", () => {
    expect(
      getHistoryStatusLabel({
        id: 2,
        outreachType: 'robocall',
        status: 'failed',
      } as HistoryRow),
    ).toBe("Couldn't send")
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

  it('labels an in_progress robocall In progress, not Scheduled', () => {
    expect(getHistoryStatusLabel(robocallRow({ status: 'in_progress' }))).toBe(
      'In progress',
    )
  })

  it('labels a completed robocall Done, reading Scheduled → In progress → Done', () => {
    expect(getHistoryStatusLabel(robocallRow({ status: 'completed' }))).toBe(
      'Done',
    )
  })

  it('labels a canceled robocall Canceled', () => {
    expect(getHistoryStatusLabel(robocallRow({ status: 'canceled' }))).toBe(
      'Canceled',
    )
  })
})
