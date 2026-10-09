import { useTestService } from '@/test-service'
import { beforeEach, describe, expect, it } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import {
  OutreachStatus,
  OutreachType,
  PrioritySource,
} from '../../../../generated/prisma'
import { PriorityFlowOutreachService } from './priorityFlowOutreach.service'

// Runs against real Postgres on purpose. The bug this guards is SQL NULL
// semantics — `priority_id <> $1` is never true for a NULL row — which a
// mocked Prisma would happily "pass".
const service = useTestService()

let outreach: PriorityFlowOutreachService
let slug: string
let officeId: string

const createPriority = async (title: string) =>
  (
    await service.prisma.priority.create({
      data: {
        electedOfficeId: officeId,
        title,
        description: title,
        source: PrioritySource.user_stated,
      },
    })
  ).id

const send = (name: string, priorityId: string | null) =>
  service.prisma.outreach.create({
    data: {
      organizationSlug: slug,
      outreachType: OutreachType.text,
      status: OutreachStatus.completed,
      name,
      priorityId,
    },
  })

beforeEach(async () => {
  outreach = service.app.get(PriorityFlowOutreachService)
  officeId = uuidv7()
  slug = `eo-${officeId}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: { id: officeId, userId: service.user.id, organizationSlug: slug },
  })
})

describe('PriorityFlowOutreachService.forOffice', () => {
  it('includes sends with no priority, which is nearly all of them', async () => {
    const bridge = await createPriority('Bridge')
    const market = await createPriority('Market')
    await send('about the bridge', bridge)
    const marketSend = await send('about the market', market)
    const newsletter = await send('office newsletter', null)

    const rows = await outreach.forOffice(slug, bridge)

    expect(rows.map((row) => row.outreachId).sort()).toEqual(
      [marketSend.id, newsletter.id].sort(),
    )
  })

  it('holds a widen only when every send put out this side of this check', async () => {
    const bridge = await createPriority('Bridge')
    const market = await createPriority('Market')
    const checkSend = (
      priorityId: string,
      priorityStepId: string,
      priorityCheckSide: string,
    ) =>
      service.prisma.outreach.create({
        data: {
          organizationSlug: slug,
          outreachType: OutreachType.text,
          priorityId,
          priorityStepId,
          priorityCheckSide,
        },
      })
    const first = await checkSend(bridge, 'define', 'main')
    const second = await checkSend(bridge, 'define', 'main')
    const contrast = await checkSend(bridge, 'define', 'contrast')
    const otherStep = await checkSend(bridge, 'options', 'main')
    const otherPriority = await checkSend(market, 'define', 'main')

    const widens = (ids: number[]) =>
      outreach.allPutOutCheck(bridge, 'define', 'main', ids)

    expect(await widens([first.id, second.id])).toBe(true)
    expect(await widens([first.id, contrast.id])).toBe(false)
    expect(await widens([otherStep.id])).toBe(false)
    expect(await widens([otherPriority.id])).toBe(false)
    expect(await widens([first.id, 999_999])).toBe(false)
    expect(await widens([])).toBe(false)
  })

  it('returns every send when the chat is not about a priority', async () => {
    const bridge = await createPriority('Bridge')
    const bridgeSend = await send('about the bridge', bridge)
    const newsletter = await send('office newsletter', null)

    const rows = await outreach.forOffice(slug, null)

    expect(rows.map((row) => row.outreachId).sort()).toEqual(
      [bridgeSend.id, newsletter.id].sort(),
    )
  })
})

describe('PriorityFlowOutreachService.forOffice campaign isolation', () => {
  it("leaves out the org's campaign sends", async () => {
    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `${slug}-campaign`,
        organizationSlug: slug,
      },
    })
    await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: slug,
        outreachType: OutreachType.text,
        name: 'get out the vote',
      },
    })
    const newsletter = await send('office newsletter', null)

    const rows = await outreach.forOffice(slug, null)

    expect(rows.map((row) => row.outreachId)).toEqual([newsletter.id])
  })
})

describe('PriorityFlowOutreachService.forCampaign', () => {
  it("reads only the campaign's sends, not its org's office", async () => {
    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `${slug}-campaign`,
        organizationSlug: slug,
      },
    })
    const campaignSend = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: slug,
        outreachType: OutreachType.text,
        name: 'get out the vote',
      },
    })
    await send('office newsletter', null)

    const rows = await outreach.forCampaign(campaign.id)

    expect(rows.map((row) => row.outreachId)).toEqual([campaignSend.id])
  })
})
