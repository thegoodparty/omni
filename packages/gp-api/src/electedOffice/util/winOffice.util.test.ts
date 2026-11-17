import { describe, expect, it } from 'vitest'
import { canPrepareOffice, campaignWinState } from './winOffice.util'

const NOW = new Date('2026-11-02T12:00:00Z')

const campaign = ({
  didWin = null,
  details = {},
  data = {},
}: {
  didWin?: boolean | null
  details?: PrismaJson.CampaignDetails
  data?: PrismaJson.CampaignData
}) => ({ didWin, details, data })

const hubSpot = (result: string): PrismaJson.CampaignData => ({
  hubSpotUpdates: { election_results: result },
})

describe('campaignWinState', () => {
  it('reads didWin first, then wonGeneral, then HubSpot', () => {
    expect(
      campaignWinState(
        campaign({
          didWin: false,
          details: { wonGeneral: true },
          data: hubSpot('Won General'),
        }),
        NOW,
      ),
    ).toEqual({ state: 'not_won' })
    expect(
      campaignWinState(
        campaign({
          details: { wonGeneral: true },
          data: hubSpot('lost general'),
        }),
        NOW,
      ),
    ).toEqual({ state: 'won', source: 'self_reported' })
    expect(
      campaignWinState(campaign({ data: hubSpot(' Won General ') }), NOW),
    ).toEqual({ state: 'won', source: 'ddhq' })
    expect(campaignWinState(campaign({ didWin: true }), NOW)).toEqual({
      state: 'won',
      source: 'ddhq',
    })
  })

  it('has no answer when nothing is on record', () => {
    expect(
      campaignWinState(campaign({ data: hubSpot('runoff') }), NOW),
    ).toEqual({ state: 'unknown' })
  })

  it("reads HubSpot's result as the last race's once a new election is ahead", () => {
    const rerun = (electionDate: string) =>
      campaign({ details: { electionDate }, data: hubSpot('Won General') })
    expect(campaignWinState(rerun('2027-11-02'), NOW)).toEqual({
      state: 'not_won',
    })
    expect(campaignWinState(rerun('2026-11-02'), NOW)).toEqual({
      state: 'won',
      source: 'ddhq',
    })
  })

  it('keeps an explicit result whatever the election date says', () => {
    expect(
      campaignWinState(
        campaign({
          details: { electionDate: '2027-11-02', wonGeneral: true },
        }),
        NOW,
      ),
    ).toEqual({ state: 'won', source: 'self_reported' })
  })
})

describe('canPrepareOffice', () => {
  const pro = {
    isPro: true,
    didWin: null,
    data: {},
  }

  it('prepares an ever-Pro campaign whose election date has just passed', () => {
    expect(
      canPrepareOffice(
        { ...pro, details: { electionDate: '2026-10-28' } },
        NOW,
      ),
    ).toBe(true)
    expect(
      canPrepareOffice(
        { ...pro, details: { electionDate: '2026-10-12' } },
        NOW,
      ),
    ).toBe(true)
  })

  it('stops preparing once the prepare window has closed', () => {
    expect(
      canPrepareOffice(
        { ...pro, details: { electionDate: '2026-10-02' } },
        NOW,
      ),
    ).toBe(false)
  })

  it('does not prepare a campaign whose election is still ahead', () => {
    expect(
      canPrepareOffice(
        { ...pro, details: { electionDate: '2026-11-03' } },
        NOW,
      ),
    ).toBe(false)
  })

  it('does not prepare a campaign that was never Pro', () => {
    expect(
      canPrepareOffice(
        {
          isPro: false,
          didWin: null,
          data: {},
          details: { electionDate: '2026-10-28', subscriptionId: null },
        },
        NOW,
      ),
    ).toBe(false)
  })

  it('prepares a campaign that cancelled Pro after subscribing', () => {
    expect(
      canPrepareOffice(
        {
          ...pro,
          isPro: false,
          details: {
            electionDate: '2026-10-28',
            subscriptionCanceledAt: 1_700_000_000_000,
          },
        },
        NOW,
      ),
    ).toBe(true)
  })

  it('does not prepare a campaign that already has a result', () => {
    expect(
      canPrepareOffice(
        { ...pro, didWin: true, details: { electionDate: '2026-10-28' } },
        NOW,
      ),
    ).toBe(false)
    expect(
      canPrepareOffice(
        { ...pro, didWin: false, details: { electionDate: '2026-10-28' } },
        NOW,
      ),
    ).toBe(false)
    expect(
      canPrepareOffice(
        {
          ...pro,
          details: { electionDate: '2026-10-28', wonGeneral: true },
        },
        NOW,
      ),
    ).toBe(false)
  })

  it('does not prepare a campaign with no election date on record', () => {
    expect(canPrepareOffice({ ...pro, details: {} }, NOW)).toBe(false)
  })
})
