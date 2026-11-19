import { PLAN_PRICING } from '@goodparty_org/contracts'
import { describe, expect, it } from 'vitest'
import { useTestService } from '../src/test-service'
import {
  convertCampaign,
  formatReport,
  run,
  type SqlRunner,
} from './convert-free-texts-to-credits'

describe('convert-free-texts-to-credits', () => {
  const service = useTestService()

  const db = (): SqlRunner => ({
    query: <T>(sql: string, params: unknown[]) =>
      service.prisma.$queryRawUnsafe<T[]>(sql, ...params),
  })

  const unique = () => Math.random().toString(36).slice(2, 10)

  const insertCampaign = async (
    overrides: {
      hasFreeTextsOffer?: boolean
      outreachCreditCents?: number
    } = {},
  ): Promise<number> => {
    const user = await service.prisma.user.create({
      data: {
        email: `owner-${unique()}@example.com`,
        firstName: 'Test',
        lastName: 'Owner',
      },
    })
    const slug = `convert-${unique()}`
    await service.prisma.organization.create({
      data: { slug, ownerId: user.id },
    })
    const campaign = await service.prisma.campaign.create({
      data: {
        slug,
        organizationSlug: slug,
        userId: user.id,
        hasFreeTextsOffer: overrides.hasFreeTextsOffer ?? true,
        outreachCreditCents: overrides.outreachCreditCents ?? 0,
      },
    })
    return campaign.id
  }

  const insertSend = async (
    campaignId: number,
    send: {
      status: 'pending_payment' | 'completed'
      hold?: {
        settleState: 'authorized' | 'captured'
        freeTextsApplied: boolean
      }
    },
  ) => {
    const campaign = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
    })
    const outreach = await service.prisma.outreach.create({
      data: {
        campaignId,
        organizationSlug: campaign.organizationSlug,
        outreachType: 'p2p',
        status: send.status,
      },
    })
    if (send.hold) {
      await service.prisma.outreachP2pSms.create({
        data: { outreachId: outreach.id, ...send.hold },
      })
    }
  }

  const readCampaign = (id: number) =>
    service.prisma.campaign.findUniqueOrThrow({
      where: { id },
      select: { hasFreeTextsOffer: true, outreachCreditCents: true },
    })

  it('writes nothing on a dry run but reports the campaign', async () => {
    const id = await insertCampaign()

    const report = await run(db(), { apply: false })

    expect(report.converted).toContain(id)
    expect(await readCampaign(id)).toEqual({
      hasFreeTextsOffer: true,
      outreachCreditCents: 0,
    })
    expect(formatReport(report)).toContain('DRY RUN')
  })

  it('credits an eligible campaign once and changes nothing on a re-run', async () => {
    const id = await insertCampaign({ outreachCreditCents: 500 })

    const first = await run(db(), { apply: true })
    const second = await run(db(), { apply: true })

    expect(first.converted).toContain(id)
    expect(second.converted).not.toContain(id)
    expect(await readCampaign(id)).toEqual({
      hasFreeTextsOffer: false,
      outreachCreditCents: 500 + PLAN_PRICING.includedCreditCents,
    })
  })

  it('leaves a campaign without an offer alone', async () => {
    const id = await insertCampaign({ hasFreeTextsOffer: false })

    await run(db(), { apply: true })

    expect(await readCampaign(id)).toEqual({
      hasFreeTextsOffer: false,
      outreachCreditCents: 0,
    })
  })

  it('skips and lists a campaign with a send in pending_payment', async () => {
    const id = await insertCampaign()
    await insertSend(id, { status: 'pending_payment' })

    const report = await run(db(), { apply: true })

    expect(report.skippedInFlight).toContain(id)
    expect(report.converted).not.toContain(id)
    expect(formatReport(report)).toContain(String(id))
    expect((await readCampaign(id)).hasFreeTextsOffer).toBe(true)
  })

  it('skips a campaign whose unsettled hold carries freeTextsApplied', async () => {
    const id = await insertCampaign()
    await insertSend(id, {
      status: 'completed',
      hold: { settleState: 'authorized', freeTextsApplied: true },
    })

    const report = await run(db(), { apply: true })

    expect(report.skippedInFlight).toContain(id)
    expect((await readCampaign(id)).outreachCreditCents).toBe(0)
  })

  it('converts a campaign whose holds are settled or never used the offer', async () => {
    const settled = await insertCampaign()
    await insertSend(settled, {
      status: 'completed',
      hold: { settleState: 'captured', freeTextsApplied: true },
    })
    const unused = await insertCampaign()
    await insertSend(unused, {
      status: 'completed',
      hold: { settleState: 'authorized', freeTextsApplied: false },
    })

    const report = await run(db(), { apply: true })

    expect(report.converted).toEqual(expect.arrayContaining([settled, unused]))
  })

  it('does not credit a campaign whose send went in flight after the read', async () => {
    const id = await insertCampaign()
    await insertSend(id, { status: 'pending_payment' })

    expect(await convertCampaign(db(), id)).toBe(false)
    expect((await readCampaign(id)).outreachCreditCents).toBe(0)
  })
})
