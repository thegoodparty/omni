import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import {
  DoorKnockOutcome,
  OutreachStatus,
  OutreachType,
  PriorityAnswerCode,
  PriorityAnswerSource,
  PrioritySource,
  Prisma,
  UserRole,
} from '@/generated/prisma'
import { FeedbackSynthesisService } from '@/constituentFeedback/services/feedbackSynthesis.service'
import {
  knock,
  seedKnockMemo,
  seedTurfEffort,
} from '@/constituentFeedback/tests/issueCaptureFixtures'
import { LlmService } from '@/llm/services/llm.service'
import { useTestService } from '@/test-service'
import { PriorityAnswerCodingService } from './services/priorityAnswerCoding.service'

const service = useTestService()

const MAIN_QUESTION = 'Does your street flood after a heavy rain?'
const CONTRAST_QUESTION = 'Would you pay a small fee to fix the drains?'

const PEOPLE = [
  { personId: 'person-yes', phone: '+13035550301' },
  { personId: 'person-no', phone: '+13035550302' },
  { personId: 'person-stop', phone: '+13035550303' },
  { personId: 'person-silent', phone: '+13035550304' },
]

const RESULTS_CSV = [
  'Contact Phone Number,Message Text,Sent At,Send Direction',
  '+13035550301,Yes I would,2026-10-11T15:00:00.000Z,INBOUND',
  '+13035550301,as long as it is small,2026-10-11T15:05:00.000Z,INBOUND',
  '+13035550302,No way,2026-10-11T15:10:00.000Z,INBOUND',
  '+13035550303,STOP,2026-10-11T15:20:00.000Z,INBOUND',
].join('\n')

type Reply = { id: string; kind: string; text: string }

const repliesIn = (prompt: string): Reply[] =>
  JSON.parse(prompt.split('as JSON:\n')[1] ?? '[]')

const userPromptOf = (
  completion: MockInstance<LlmService['jsonCompletion']>,
  call = 0,
): string => {
  const content = completion.mock.calls[call]?.[0].messages[1]?.content
  if (typeof content !== 'string') throw new Error('no user prompt')
  return content
}

let slug: string
let electedOfficeId: string
let priorityId: string
let completion: MockInstance<LlmService['jsonCompletion']>

// Codes by the words, so a test can tell which reply got which code.
const mockClassifier = () =>
  vi
    .spyOn(service.app.get(LlmService), 'jsonCompletion')
    .mockImplementation(async (options) => {
      const prompt = options.messages[1]?.content
      const replies = typeof prompt === 'string' ? repliesIn(prompt) : []
      return {
        object: {
          answers: replies.map((reply) => ({
            id: reply.id,
            code: /no/i.test(reply.text) ? 'no' : 'yes',
          })),
        },
        model: 'claude-test',
        tokens: 0,
        inputTokens: 0,
        outputTokens: 0,
      }
    })

beforeEach(async () => {
  // The results upload is AdminOrM2M-gated.
  await service.prisma.user.update({
    where: { id: service.user.id },
    data: { roles: [UserRole.admin] },
  })
  electedOfficeId = uuidv7()
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
        title: 'Oak Street flooding',
        description: 'Drains back up into homes.',
        source: PrioritySource.user_stated,
        status: {
          version: 3,
          steps: [
            {
              id: 'define',
              state: 'settled',
              summary: 'Oak Street floods',
              check: {
                state: 'out',
                who: 'Oak Street homeowners',
                question: MAIN_QUESTION,
                raised: 0,
                contrast: {
                  state: 'out',
                  who: 'Renters elsewhere',
                  question: CONTRAST_QUESTION,
                },
              },
            },
          ],
        },
      },
    })
  ).id
  vi.spyOn(
    service.app.get(FeedbackSynthesisService),
    'requestRunOnEffortCompleted',
  ).mockImplementation(() => undefined)
  completion = mockClassifier()
})

describe('coding a text send when its results land', () => {
  const createSend = async (link: { priorityId: string | null }) => {
    const send = await service.prisma.outreach.create({
      data: {
        organizationSlug: slug,
        outreachType: OutreachType.text,
        status: OutreachStatus.in_progress,
        name: 'Renters on drain fees',
        message: 'Hi from the Mayor. Reply STOP to opt out.',
        scheduledLocalDate: '2026-10-10',
        priorityId: link.priorityId,
        priorityStepId: 'define',
        priorityCheckSide: 'contrast',
      },
    })
    await service.prisma.outreachTextRecipient.createMany({
      data: PEOPLE.map((person) => ({
        outreachId: send.id,
        organizationSlug: slug,
        personId: person.personId,
        phone: person.phone,
      })),
    })
    await service.prisma.contactInteractionText.createMany({
      data: PEOPLE.map((person) => ({
        outreachId: send.id,
        organizationSlug: slug,
        personId: person.personId,
        occurredAt: new Date(),
      })),
    })
    return send
  }

  const upload = (outreachId: number) =>
    service.client.post(`/v1/outreach/admin/results/sms/${outreachId}`, {
      fileName: 'results.csv',
      csv: RESULTS_CSV,
      dryRun: false,
      sourceLabel: 'gp-admin upload by staffer@goodparty.org',
    })

  const answersOn = (outreachId: number) =>
    service.prisma.priorityAnswer.findMany({
      where: { outreachId },
      orderBy: { personId: Prisma.SortOrder.asc },
    })

  it('codes each respondent once, against the side of the check it put out', async () => {
    const send = await createSend({ priorityId })

    const result = await upload(send.id)

    expect(result.status).toBe(HttpStatus.CREATED)
    expect(result.data.committed).toBe(true)
    await vi.waitFor(async () => {
      expect(await answersOn(send.id)).toHaveLength(2)
    })
    const answers = await answersOn(send.id)
    expect(answers).toEqual([
      expect.objectContaining({
        organizationSlug: slug,
        personId: 'person-no',
        source: PriorityAnswerSource.text,
        sourceId: `${send.id}:person-no`,
        code: PriorityAnswerCode.no,
        model: 'claude-test',
      }),
      expect.objectContaining({
        personId: 'person-yes',
        sourceId: `${send.id}:person-yes`,
        code: PriorityAnswerCode.yes,
      }),
    ])

    // One call for the send, the contrast side's question, and a person's
    // replies read together. The opt-out and the silent are never sent.
    expect(completion).toHaveBeenCalledTimes(1)
    const prompt = userPromptOf(completion)
    expect(prompt).toContain(`The question: ${CONTRAST_QUESTION}`)
    expect(prompt).not.toContain(MAIN_QUESTION)
    expect(repliesIn(prompt).map((reply) => reply.text)).toEqual([
      'Yes I would\nas long as it is small',
      'No way',
    ])
    expect(prompt).not.toContain('person-')
  })

  it('does not code the same words twice', async () => {
    const send = await createSend({ priorityId })
    await upload(send.id)
    await vi.waitFor(async () => {
      expect(await answersOn(send.id)).toHaveLength(2)
    })
    const first = await answersOn(send.id)
    completion.mockClear()

    await service.app.get(PriorityAnswerCodingService).codeOutreach(send.id)

    expect(completion).not.toHaveBeenCalled()
    expect(await answersOn(send.id)).toEqual(first)
  })

  it('codes nothing on a send that belongs to no priority', async () => {
    const send = await createSend({ priorityId: null })

    await upload(send.id)

    expect(
      await service.app.get(PriorityAnswerCodingService).codeOutreach(send.id),
    ).toBe(0)
    expect(completion).not.toHaveBeenCalled()
    expect(await answersOn(send.id)).toEqual([])
  })

  // The replies stay uncoded, and the next pass reads them again.
  it('writes nothing when the model call fails', async () => {
    completion.mockRejectedValue(new Error('upstream 529'))
    const send = await createSend({ priorityId })
    const coding = service.app.get(PriorityAnswerCodingService)

    await upload(send.id)
    await vi.waitFor(() => expect(completion).toHaveBeenCalled())
    expect(await coding.codeOutreach(send.id)).toBe(0)
    expect(await answersOn(send.id)).toEqual([])

    completion.mockRestore()
    completion = mockClassifier()
    expect(await coding.codeOutreach(send.id)).toBe(2)
  })
})

describe('the sweep', () => {
  it('codes a walk’s memos once a slot and skips a door with no words', async () => {
    const effort = await seedTurfEffort(service, slug, {
      question: 'Has your basement flooded?',
      people: 3,
    })
    await service.prisma.outreach.update({
      where: { id: effort.outreachId },
      data: { priorityId },
    })
    const [withMemo, noMemo, notHome] = effort.targets
    if (!withMemo || !noMemo || !notHome) throw new Error('seed')
    const { memo } = await seedKnockMemo(service, {
      slug,
      outreachId: effort.outreachId,
      personId: withMemo.personId,
      transcript: 'She said no, her street is fine.',
    })
    await knock(service, {
      slug,
      outreachId: effort.outreachId,
      personId: noMemo.personId,
    })
    await knock(service, {
      slug,
      outreachId: effort.outreachId,
      personId: notHome.personId,
      outcome: DoorKnockOutcome.not_home,
    })
    const coding = service.app.get(PriorityAnswerCodingService)
    const now = new Date()

    await coding.sweep(now)
    await coding.sweep(now)

    const answers = await service.prisma.priorityAnswer.findMany({
      where: { outreachId: effort.outreachId },
    })
    expect(answers).toEqual([
      expect.objectContaining({
        personId: withMemo.personId,
        source: PriorityAnswerSource.door_knocking,
        sourceId: memo.doorKnockInteractionId,
        code: PriorityAnswerCode.no,
      }),
    ])
    expect(completion).toHaveBeenCalledTimes(1)
    // The walk carries no check, so it falls back to the turf's question.
    const prompt = userPromptOf(completion)
    expect(prompt).toContain('The question: Has your basement flooded?')
    expect(repliesIn(prompt)).toEqual([
      {
        id: '1',
        kind: 'conversation_note',
        text: 'She said no, her street is fine.',
      },
    ])
  })
})
