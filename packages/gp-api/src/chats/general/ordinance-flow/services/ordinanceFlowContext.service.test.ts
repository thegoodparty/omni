import { describe, expect, it } from 'vitest'
import { ChatScope } from '../../../../generated/prisma'
import { useTestService } from '@/test-service'
import { OrdinanceFlowContextService } from './ordinanceFlowContext.service'

const service = useTestService()

const seed = async (
  opts: { codeRecord?: boolean; codeFound?: boolean; sourceLink?: string } = {},
) => {
  const user = await service.prisma.user.create({
    data: {
      email: `ctx-${Math.random().toString(36).slice(2, 10)}@goodparty.org`,
    },
  })
  const slug = `ctx-eo-${Math.random().toString(36).slice(2, 10)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: user.id },
  })
  const electedOffice = await service.prisma.electedOffice.create({
    data: { organizationSlug: slug, userId: user.id },
  })
  const ordinance = await service.prisma.ordinance.create({
    data: {
      electedOfficeId: electedOffice.id,
      seedType: 'new',
      ...(opts.sourceLink && { sourceLink: opts.sourceLink }),
    },
  })
  if (opts.codeRecord) {
    await service.prisma.ordinanceCodeRecord.create({
      data: {
        organizationSlug: slug,
        codeFound: opts.codeFound ?? true,
        dataQuality: opts.codeFound === false ? 'NOT_FOUND' : 'OK',
        confidence: 'HIGH',
        hostType: 'MUNICODE',
        url: 'https://library.municode.com/nc/hendersonville',
        place: 'Hendersonville',
        state: 'NC',
        verifiedEvidence: 'Homepage lists City of Hendersonville, NC.',
        artifactBucket: 'gp-agent-artifacts-test',
        artifactKey: 'find_existing_ordinances/run-1/output.json',
        verifiedAt: new Date(),
      },
    })
  }
  const conversation = await service.prisma.chatConversation.create({
    data: {
      ownerUserId: user.id,
      scope: ChatScope.ordinance_flow,
      organizationSlug: slug,
      anchor: {
        resourceType: 'ordinance',
        resourceId: ordinance.id,
        url: `/dashboard/ordinances/solve/${ordinance.slug}/authority`,
        snapshot: { title: 'Shade trees', summary: 'Require shade trees' },
        step: 'authority',
      },
    },
  })
  return { userId: user.id, conversationId: conversation.id }
}

describe('OrdinanceFlowContextService jurisdiction', () => {
  it('falls back to the verified code record municipality', async () => {
    const { userId, conversationId } = await seed({ codeRecord: true })
    const ctx = await service.app
      .get(OrdinanceFlowContextService)
      .load(conversationId, userId)
    expect(ctx.jurisdiction).toBe('Hendersonville, NC')
  })

  it('leaves jurisdiction null when the code record is codeFound:false', async () => {
    const { userId, conversationId } = await seed({
      codeRecord: true,
      codeFound: false,
    })
    const ctx = await service.app
      .get(OrdinanceFlowContextService)
      .load(conversationId, userId)
    expect(ctx.jurisdiction).toBeNull()
  })

  it('leaves jurisdiction null when no code record exists', async () => {
    const { userId, conversationId } = await seed()
    const ctx = await service.app
      .get(OrdinanceFlowContextService)
      .load(conversationId, userId)
    expect(ctx.jurisdiction).toBeNull()
  })
})

describe('OrdinanceFlowContextService source link', () => {
  it('surfaces the persisted source link so the flow can amend it', async () => {
    const url = 'https://library.municode.com/nc/hendersonville/ch-42'
    const { userId, conversationId } = await seed({ sourceLink: url })
    const ctx = await service.app
      .get(OrdinanceFlowContextService)
      .load(conversationId, userId)
    expect(ctx.sourceLink).toBe(url)
  })

  it('leaves the source link null when none was provided', async () => {
    const { userId, conversationId } = await seed()
    const ctx = await service.app
      .get(OrdinanceFlowContextService)
      .load(conversationId, userId)
    expect(ctx.sourceLink).toBeNull()
  })
})
