import { parseISO } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AgentMessageRole,
  ChatScope,
} from '@/generated/prisma'
import { DistrictsService } from '@/electionDb/districts/districts.service'
import { PositionsService } from '@/electionDb/positions/positions.service'
import { useTestService } from '@/test-service'
import { CaseScoutMessagesService } from '../services/caseScoutMessages.service'

// The read that replaced the case_scout_messages Databricks view, against
// real rows. The election database is the only edge stubbed.
const service = useTestService()

const POSITION_ID = '6f1d2c3b-0a4e-4b8f-9c7d-1e2f3a4b5c6d'
const OVERRIDE_DISTRICT_ID = '8b3c4d5e-2f3a-4b6c-9d0e-1f2a3b4c5d6e'

let counter = 0
const seedChat = async (email: string, scope = ChatScope.chief_of_staff) => {
  counter++
  const owner = await service.prisma.user.create({
    data: { email, firstName: 'Robin', lastName: 'Vale' },
  })
  const conversation = await service.prisma.chatConversation.create({
    data: { id: `conv-read-${counter}`, ownerUserId: owner.id, scope },
  })
  await service.prisma.agentMessage.create({
    data: {
      id: `msg-read-${counter}`,
      conversationId: conversation.id,
      index: 0,
      role: AgentMessageRole.user,
      parts: [{ type: 'text', text: 'A question.' }],
      createdAt: parseISO('2026-11-15T12:00:00.000Z'),
    },
  })
  return conversation.id
}

const read = (dropInternal: boolean) =>
  service.app
    .get(CaseScoutMessagesService)
    .readSince(parseISO('2026-11-15T00:00:00.000Z'), dropInternal)

describe('CaseScoutMessagesService', () => {
  beforeEach(() => {
    counter = 0
  })

  it('drops staff and test accounts only when asked, and never returns an email', async () => {
    const customer = await seedChat('candidate@example.com')
    const staff = await seedChat('someone@GoodParty.org')
    const plusTest = await seedChat('candidate+TEST1@example.com')
    const mailinator = await seedChat('x@Mailinator.com')

    const all = await read(false)
    expect(
      Object.fromEntries(all.map((m) => [m.conversationId, m.isInternal])),
    ).toEqual({
      [customer]: false,
      [staff]: true,
      [plusTest]: true,
      [mailinator]: true,
    })
    expect(JSON.stringify(all)).not.toContain('@')

    expect((await read(true)).map((m) => m.conversationId)).toEqual([customer])
  })

  it('leaves out deleted conversations', async () => {
    const id = await seedChat('candidate@example.com')
    await service.prisma.chatConversation.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    expect(await read(false)).toEqual([])
  })

  it('builds the denylist from the account, the campaign and the office', async () => {
    const orgOwner = await service.prisma.user.create({
      data: {
        email: 'owner@example.com',
        firstName: ' Avery ',
        lastName: 'Quillon',
      },
    })
    await service.prisma.organization.create({
      data: {
        slug: 'deny-org',
        ownerId: orgOwner.id,
        positionId: POSITION_ID,
        overrideDistrictId: OVERRIDE_DISTRICT_ID,
        customPositionName: 'Lakemoor Water Board',
      },
    })
    await service.prisma.campaign.create({
      data: {
        slug: 'deny-campaign',
        userId: orgOwner.id,
        organizationSlug: 'deny-org',
        details: {
          campaignCommittee: 'Friends of Avery',
          city: 'Lakemoor',
          county: '',
          district: 'Ward 2',
          office: 'Legacy Office Name',
        },
      },
    })
    const member = await service.prisma.user.create({
      data: { email: 'member@example.com', firstName: 'Avery', lastName: '' },
    })
    await service.prisma.chatConversation.create({
      data: {
        id: 'conv-deny',
        ownerUserId: member.id,
        scope: ChatScope.chief_of_staff,
        organizationSlug: 'deny-org',
      },
    })
    await service.prisma.agentMessage.create({
      data: {
        id: 'msg-deny',
        conversationId: 'conv-deny',
        index: 0,
        role: AgentMessageRole.user,
        parts: [{ type: 'text', text: 'A question.' }],
      },
    })
    const positions = vi
      .spyOn(service.app.get(PositionsService), 'findMany')
      .mockResolvedValue([
        {
          id: POSITION_ID,
          name: 'Lakemoor City Council',
          district: { L2DistrictName: 'Lakemoor Ward 2' },
        },
      ] as never)
    vi.spyOn(service.app.get(DistrictsService), 'findMany').mockResolvedValue([
      { id: OVERRIDE_DISTRICT_ID, L2DistrictName: 'Override District' },
    ] as never)

    const [message] = await read(false)

    expect(message?.denylist).toEqual([
      'Avery',
      'Quillon',
      'Friends of Avery',
      'Lakemoor City Council',
      'Lakemoor Water Board',
      'Legacy Office Name',
      'Lakemoor',
      'Ward 2',
      'Lakemoor Ward 2',
      'Override District',
    ])
    expect(positions).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [POSITION_ID] } } }),
    )
  })
})
