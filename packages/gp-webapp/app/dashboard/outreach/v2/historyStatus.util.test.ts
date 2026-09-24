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

describe('getHistoryStatusLabel — Serve SMS', () => {
  // The SURFACE decides. `campaignId == null` was the first discriminator and
  // is wrong: the field is optional on the client row, so a Win text row that
  // simply omits it is indistinguishable from an org-scoped one — the
  // "leaves a draft with no footer" drawer test is the row shape that proves
  // it. `phoneListId` still separates this from a P2P-flow row.
  const serveSmsRow = (overrides: Partial<HistoryRow>): HistoryRow =>
    ({
      id: 3,
      outreachType: 'text',
      phoneListId: null,
      ...overrides,
    }) as HistoryRow

  it('labels a pending Serve SMS Scheduled, not In review', () => {
    // `pending` here is PAID and waiting for its send date. "In review" is the
    // Political Assistant meaning and would tell an official a human is
    // looking at their request, which nobody is.
    expect(
      getHistoryStatusLabel(serveSmsRow({ status: 'pending' }), null, true),
    ).toBe('Scheduled')
  })

  it('labels an in_progress Serve SMS In progress, not Scheduled', () => {
    // Set at the fulfilment handoff and held until the reply ingest completes
    // the row: the send is out and responses are coming back, which is the
    // opposite of what "Scheduled" says.
    expect(
      getHistoryStatusLabel(serveSmsRow({ status: 'in_progress' }), null, true),
    ).toBe('In progress')
  })

  it('reads Scheduled → In progress → Done across the lifecycle', () => {
    expect(
      getHistoryStatusLabel(serveSmsRow({ status: 'completed' }), null, true),
    ).toBe('Done')
    expect(
      getHistoryStatusLabel(
        serveSmsRow({ status: 'pending_payment' }),
        null,
        true,
      ),
    ).toBe('Pending payment')
    expect(
      getHistoryStatusLabel(serveSmsRow({ status: 'canceled' }), null, true),
    ).toBe('Canceled')
  })

  // The whole constraint on the change above: legacy Win text rows share
  // nonP2pStatusLabels, and their vocabulary must not move. The default
  // argument is what guarantees it — a Win caller passes nothing.
  it('leaves a legacy Win text row reading exactly as it did', () => {
    const winTextRow = (status: HistoryRow['status']): HistoryRow =>
      ({
        id: 4,
        outreachType: 'text',
        phoneListId: null,
        campaignId: 99,
        status,
      }) as HistoryRow

    expect(getHistoryStatusLabel(winTextRow('pending'))).toBe('In review')
    expect(getHistoryStatusLabel(winTextRow('in_progress'))).toBe('Scheduled')
    expect(getHistoryStatusLabel(winTextRow('approved'))).toBe('In review')
    expect(getHistoryStatusLabel(winTextRow('completed'))).toBe('Done')
  })

  // The row shape that broke the first attempt: a Win text row carrying no
  // campaignId at all. Absence is not org-scoping, and only the surface can
  // say which this is.
  it('leaves a Win text row with no campaignId reading as Win', () => {
    const bareWinRow = {
      id: 6,
      outreachType: 'text',
      status: 'pending',
    } as HistoryRow

    expect(getHistoryStatusLabel(bareWinRow)).toBe('In review')
  })

  // Social is the other rider on that map, and a Serve org sends social too —
  // so prove the branch is keyed on the channel as well as the surface.
  it('leaves a Serve social row on the shared map', () => {
    expect(
      getHistoryStatusLabel(
        {
          id: 5,
          outreachType: 'socialMedia',
          phoneListId: null,
          status: 'pending',
        } as HistoryRow,
        null,
        true,
      ),
    ).toBe('In review')
  })

  // A Serve org that sent through the P2P flow would carry a phone list; its
  // status merges the vendor job and must not take this branch.
  it('leaves a phone-list row on the p2p path even on the Serve surface', () => {
    expect(
      getHistoryStatusLabel(
        {
          id: 7,
          outreachType: 'text',
          phoneListId: 9,
          status: 'canceled',
        } as HistoryRow,
        null,
        true,
      ),
    ).toBe('Canceled')
  })
})
