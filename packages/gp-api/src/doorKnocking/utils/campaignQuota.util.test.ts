import { HttpException, HttpStatus } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import {
  assertCampaignQuota,
  campaignsRemaining,
  dailyCampaignLimit,
  DEFAULT_DAILY_CAMPAIGN_LIMIT,
} from './campaignQuota.util'

// The shape this util actually asks for, spelled out rather than taken from
// Prisma's own args type so the two omissions it is built around are
// assertable: `deletedAt` is optional here because the util must never send
// it, and `createdAt.gte` is a plain Date because the window is the thing
// under test.
type CountArgs = {
  where: {
    voterFileFilter: { organizationSlug: string }
    createdAt: { gte: Date }
    deletedAt?: null
  }
}

// One query is the whole surface, so a client that answers it and records
// what it was asked is the entire seam. The routes suite proves these rules
// against real rows; this file is for the arithmetic and for the `where`,
// whose deliberate omission of `deletedAt` is invisible end to end unless a
// test deletes a turf specifically to catch it.
const clientCounting = (turfs: number) => {
  const calls: CountArgs[] = []
  return {
    client: {
      doorKnockingTurf: {
        count: (args: CountArgs) => {
          calls.push(args)
          return Promise.resolve(turfs)
        },
      },
    } as never,
    calls,
  }
}

// The allowance now rides the organization row, so every call takes one. An
// org on the default is the null case rather than an absent field — that is
// what the column holds until an admin writes it.
const org = (overrideDoorKnockingCampaignLimit: number | null = null) => ({
  slug: 'campaign-org',
  overrideDoorKnockingCampaignLimit,
})

const WINDOW_MS = 24 * 60 * 60 * 1000

describe('dailyCampaignLimit', () => {
  it('falls back to the default when the org has no override', () => {
    expect(dailyCampaignLimit(org())).toBe(DEFAULT_DAILY_CAMPAIGN_LIMIT)
  })

  it('honours an override', () => {
    expect(dailyCampaignLimit(org(12))).toBe(12)
  })

  // Below the default as well as above it. The column is the org's allowance
  // and not a floor over the default, so an admin can also hold one
  // organization back — which is the same write and must not be quietly
  // clamped up to five.
  it('honours an override lower than the default', () => {
    expect(dailyCampaignLimit(org(2))).toBe(2)
  })
})

describe('campaignsRemaining', () => {
  it.each([
    [0, 5],
    [1, 4],
    [4, 1],
    [5, 0],
  ])('reports %i campaigns built as %i left', async (built, left) => {
    const { client } = clientCounting(built)

    expect(await campaignsRemaining(client, org())).toBe(left)
  })

  // The reason the limit rides the response instead of being a constant the
  // client keeps its own copy of: a raised org's remainder is measured
  // against its own allowance, so a hardcoded five would be wrong for exactly
  // the organizations somebody went to the trouble of raising.
  it('measures a raised org against its own allowance', async () => {
    const { client } = clientCounting(6)

    expect(await campaignsRemaining(client, org(20))).toBe(14)
  })

  // An organization CAN end a window past the limit: two simultaneous creates
  // both pass the gate, which the util documents as the accepted cost of not
  // serializing every create behind a vendor call. What must not happen is
  // that overshoot reaching a client as a negative allowance.
  it('clamps an overshoot at zero rather than reporting a debt', async () => {
    const { client } = clientCounting(DEFAULT_DAILY_CAMPAIGN_LIMIT + 2)

    expect(await campaignsRemaining(client, org())).toBe(0)
  })

  // A turf reaches its organization only through its saved filter — there is
  // no slug on the turf — so a query written any other way would either not
  // compile or count the whole table.
  it("scopes the count to the organization's own filters", async () => {
    const { client, calls } = clientCounting(0)

    await campaignsRemaining(client, org())

    expect(calls[0]?.where.voterFileFilter).toEqual({
      organizationSlug: 'campaign-org',
    })
  })

  // A rolling window rather than a calendar day, because campaigns knock in
  // every US time zone and nothing on the organization says which one.
  it('looks back exactly 24 hours from now', async () => {
    const { client, calls } = clientCounting(0)
    const before = Date.now()

    await campaignsRemaining(client, org())

    const gte = calls[0]!.where.createdAt.gte.getTime()
    expect(gte).toBeGreaterThanOrEqual(before - WINDOW_MS)
    expect(gte).toBeLessThanOrEqual(Date.now() - WINDOW_MS)
  })

  // The one assertion about a clause that is absent. Every turf was billed
  // for a Geoapify route when it was created, so shelving the row does not
  // give the money back — and a query that skipped tombstones would make
  // Delete the way to buy unlimited routes.
  it('counts turfs the organization has since deleted', async () => {
    const { client, calls } = clientCounting(0)

    await campaignsRemaining(client, org())

    expect(calls[0]?.where).not.toHaveProperty('deletedAt')
  })
})

describe('assertCampaignQuota', () => {
  // The counts here include the turf the create transaction has ALREADY
  // inserted, because the row is written before the vendor call so the spend
  // ledger can name it. So the fifth create of a window sees five rows and
  // must pass, and only the sixth — seeing six — is refused. Both of those
  // report zero remaining, which is why this gate counts rather than reading
  // the remainder.
  it('allows the create that lands exactly on the limit', async () => {
    const { client } = clientCounting(DEFAULT_DAILY_CAMPAIGN_LIMIT)

    await expect(assertCampaignQuota(client, org())).resolves.toBeUndefined()
  })

  it('refuses the one past it as 429, not 400', async () => {
    const { client } = clientCounting(DEFAULT_DAILY_CAMPAIGN_LIMIT + 1)

    await expect(assertCampaignQuota(client, org())).rejects.toThrow(
      HttpException,
    )
    await expect(assertCampaignQuota(client, org())).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    })
  })

  // The gate and the read have to resolve the override the same way, or a
  // raised organization is told it has campaigns left and then refused for
  // using them.
  it('lets a raised org past the default limit', async () => {
    const { client } = clientCounting(DEFAULT_DAILY_CAMPAIGN_LIMIT + 1)

    await expect(assertCampaignQuota(client, org(20))).resolves.toBeUndefined()
  })

  it('still refuses a raised org at its own limit', async () => {
    const { client } = clientCounting(21)

    await expect(assertCampaignQuota(client, org(20))).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    })
  })

  // The design's own wording, pinned verbatim: the dialog behind this refusal
  // renders whatever the server sends, so a reworded message here is a
  // reworded product surface.
  it("carries the design's wording", async () => {
    const { client } = clientCounting(DEFAULT_DAILY_CAMPAIGN_LIMIT + 1)

    await expect(assertCampaignQuota(client, org())).rejects.toThrow(
      "You've created 5 door knocking campaigns today. Go knock the doors " +
        "you've already mapped, and build more lists tomorrow.",
    )
  })

  // The number in the message is the org's own, not the constant. A raised
  // organization told it had five would be reading a limit it does not have.
  it("quotes a raised org's own limit in the refusal", async () => {
    const { client } = clientCounting(21)

    await expect(assertCampaignQuota(client, org(20))).rejects.toThrow(
      "You've created 20 door knocking campaigns today.",
    )
  })
})
