import { useTestService } from '@/test-service'
import { uuidv7 } from 'uuidv7'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DoorKnockOutcome,
  FollowUpAnswer,
  OutreachStatus,
  OutreachType,
  PhoneBankCallOutcome,
  PollIndividualMessageSender,
  PriorityAnswerCode,
  PriorityAnswerSource,
  PrioritySource,
} from '../../generated/prisma'
import { ConstituentActivityType } from '../contactEngagement.types'

const service = useTestService()

const PERSON = 'person-priority-answers'

let slug: string
let priorityId: string

const createSend = (outreachType: OutreachType, name: string) =>
  service.prisma.outreach.create({
    data: {
      organizationSlug: slug,
      outreachType,
      status: OutreachStatus.in_progress,
      name,
      priorityId,
    },
  })

const createAnswer = (
  outreachId: number,
  source: PriorityAnswerSource,
  sourceId: string,
  code: PriorityAnswerCode,
) =>
  service.prisma.priorityAnswer.create({
    data: {
      organizationSlug: slug,
      outreachId,
      personId: PERSON,
      source,
      sourceId,
      code,
      model: 'claude-test',
      codedAt: new Date(),
    },
  })

const feed = async () => {
  const result = await service.client.get(
    `/v1/contact-engagement/${PERSON}/activities`,
    { headers: { 'x-organization-slug': slug } },
  )
  expect(result.status).toBe(200)
  return result.data.results as Array<{
    type: string
    data: { priorityAnswer?: unknown }
  }>
}

beforeEach(async () => {
  const electedOfficeId = uuidv7()
  slug = `eo-${electedOfficeId}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: {
      id: electedOfficeId,
      userId: service.user.id,
      organizationSlug: slug,
    },
  })
  priorityId = (
    await service.prisma.priority.create({
      data: {
        electedOfficeId,
        title: 'Safer streets near schools',
        description: 'Crossings by the elementary school.',
        source: PrioritySource.user_stated,
      },
    })
  ).id
})

describe('priority answers on the contact card', () => {
  it('puts the coded answer on a text reply, a call and a knock', async () => {
    const text = await createSend(OutreachType.text, 'Text check')
    const calls = await createSend(OutreachType.nativePhoneBanking, 'Calls')
    const doors = await createSend(OutreachType.text, 'Door walk')

    await service.prisma.contactInteractionText.create({
      data: {
        organizationSlug: slug,
        personId: PERSON,
        outreachId: text.id,
        occurredAt: new Date('2026-10-12T15:00:00Z'),
        respondedAt: new Date('2026-10-12T16:00:00Z'),
      },
    })
    await service.prisma.pollIndividualMessage.create({
      data: {
        id: `pim-${uuidv7()}`,
        personId: PERSON,
        outreachId: text.id,
        sender: PollIndividualMessageSender.CONSTITUENT,
        content: 'Yes please, the crossing is dangerous.',
        sentAt: new Date('2026-10-12T16:00:00Z'),
      },
    })
    const call = await service.prisma.contactInteractionPhoneBanking.create({
      data: {
        organizationSlug: slug,
        personId: PERSON,
        occurredAt: new Date('2026-10-13T15:00:00Z'),
        outcome: PhoneBankCallOutcome.answered,
        followUp: FollowUpAnswer.no,
      },
    })
    const knock = await service.prisma.contactInteractionDoorKnock.create({
      data: {
        organizationSlug: slug,
        personId: PERSON,
        occurredAt: new Date('2026-10-14T15:00:00Z'),
        outcome: DoorKnockOutcome.answered,
        followUp: FollowUpAnswer.yes,
      },
    })
    await createAnswer(
      text.id,
      PriorityAnswerSource.text,
      `${text.id}:${PERSON}`,
      PriorityAnswerCode.yes,
    )
    await createAnswer(
      calls.id,
      PriorityAnswerSource.phone_banking,
      call.id,
      PriorityAnswerCode.mixed,
    )
    await createAnswer(
      doors.id,
      PriorityAnswerSource.door_knocking,
      knock.id,
      PriorityAnswerCode.no,
    )

    const results = await feed()

    const answerOf = (type: string) =>
      results.find((row) => row.type === type)?.data.priorityAnswer
    const base = { priorityId, priorityTitle: 'Safer streets near schools' }
    expect(answerOf(ConstituentActivityType.TEXT)).toEqual({
      ...base,
      answer: 'yes',
    })
    expect(answerOf(ConstituentActivityType.PHONE_BANKING)).toEqual({
      ...base,
      answer: 'mixed',
    })
    expect(answerOf(ConstituentActivityType.DOOR_KNOCK)).toEqual({
      ...base,
      answer: 'no',
    })
  })

  it('leaves a reply to a send with no coded answer without one', async () => {
    const text = await createSend(OutreachType.text, 'Text check')
    await service.prisma.contactInteractionText.create({
      data: {
        organizationSlug: slug,
        personId: PERSON,
        outreachId: text.id,
        occurredAt: new Date('2026-10-12T15:00:00Z'),
      },
    })

    const results = await feed()

    expect(results[0]?.data.priorityAnswer).toBeNull()
  })

  it('lists every answer with its priority, newest first', async () => {
    const text = await createSend(OutreachType.text, 'Text check')
    const doors = await createSend(OutreachType.text, 'Door walk')
    await createAnswer(
      text.id,
      PriorityAnswerSource.text,
      `${text.id}:${PERSON}`,
      PriorityAnswerCode.yes,
    )
    await createAnswer(
      doors.id,
      PriorityAnswerSource.door_knocking,
      'knock-1',
      PriorityAnswerCode.not_an_answer,
    )

    const result = await service.client.get(
      `/v1/contact-engagement/${PERSON}/priority-answers`,
      { headers: { 'x-organization-slug': slug } },
    )

    expect(result.status).toBe(200)
    expect(result.data.results).toEqual([
      expect.objectContaining({
        source: 'door_knocking',
        answer: 'not_an_answer',
        priorityId,
        priorityTitle: 'Safer streets near schools',
      }),
      expect.objectContaining({
        source: 'text',
        answer: 'yes',
        priorityId,
      }),
    ])
  })

  it("never lists another office's answers", async () => {
    const text = await createSend(OutreachType.text, 'Text check')
    await createAnswer(
      text.id,
      PriorityAnswerSource.text,
      `${text.id}:${PERSON}`,
      PriorityAnswerCode.yes,
    )
    const otherId = uuidv7()
    const otherSlug = `eo-${otherId}`
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })
    await service.prisma.electedOffice.create({
      data: {
        id: otherId,
        userId: service.user.id,
        organizationSlug: otherSlug,
      },
    })

    const result = await service.client.get(
      `/v1/contact-engagement/${PERSON}/priority-answers`,
      { headers: { 'x-organization-slug': otherSlug } },
    )

    expect(result.status).toBe(200)
    expect(result.data.results).toEqual([])
  })

  it('returns nothing for a campaign', async () => {
    const campaignSlug = `campaign-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug: campaignSlug, ownerId: service.user.id },
    })
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `test-${campaignSlug}`,
        organizationSlug: campaignSlug,
      },
    })

    const result = await service.client.get(
      `/v1/contact-engagement/${PERSON}/priority-answers`,
      { headers: { 'x-organization-slug': campaignSlug } },
    )

    expect(result.status).toBe(200)
    expect(result.data.results).toEqual([])
  })
})
