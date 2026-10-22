import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import {
  ConstituentFeedbackChannel,
  ConstituentFeedbackExtractionStatus,
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
import { PendingTranscriptionService } from '@/constituentFeedback/services/pendingTranscription.service'
import {
  CODING_SYSTEM_PROMPT,
  PriorityAnswerCodingService,
} from './services/priorityAnswerCoding.service'

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

// The coding calls only: a text send's replies are also read for issues,
// through the issue capture extraction, on the same model seam.
const isCoding = (
  options: Parameters<LlmService['jsonCompletion']>[0],
): boolean => options.messages[0]?.content === CODING_SYSTEM_PROMPT

const codingCalls = (completion: MockInstance<LlmService['jsonCompletion']>) =>
  completion.mock.calls.filter(([options]) => isCoding(options))

const extractionCalls = (
  completion: MockInstance<LlmService['jsonCompletion']>,
) => completion.mock.calls.filter(([options]) => !isCoding(options))

const userPromptOf = (
  completion: MockInstance<LlmService['jsonCompletion']>,
  call = 0,
): string => {
  const content = codingCalls(completion)[call]?.[0].messages[1]?.content
  if (typeof content !== 'string') throw new Error('no user prompt')
  return content
}

let slug: string
let electedOfficeId: string
let priorityId: string
let completion: MockInstance<LlmService['jsonCompletion']>

// Codes by the words, so a test can tell which reply got which code, and
// reads one issue out of any reply it is asked to extract from.
const mockClassifier = () =>
  vi
    .spyOn(service.app.get(LlmService), 'jsonCompletion')
    .mockImplementation(async (options) => {
      const prompt = options.messages[1]?.content
      if (!isCoding(options)) {
        return {
          object: {
            issues: [
              {
                issueLabel: 'Drain fees',
                stance: /no/i.test(String(prompt)) ? 'opposes' : 'mixed',
                desiredOutcome: 'Keep the fee small',
              },
            ],
            confidence: 0.8,
          },
          model: 'claude-test',
          tokens: 0,
          inputTokens: 0,
          outputTokens: 0,
        }
      }
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
    expect(codingCalls(completion)).toHaveLength(1)
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

  // A reply to a priority's check also goes through issue capture, so it
  // shows in What they told us beside the door and phone memos.
  describe('issue capture of the replies', () => {
    const feedbackOn = () =>
      service.prisma.constituentFeedback.findMany({
        where: { organizationSlug: slug },
        include: { issues: { orderBy: { position: Prisma.SortOrder.asc } } },
        orderBy: { personId: Prisma.SortOrder.asc },
      })

    const uploadAndCode = async () => {
      const send = await createSend({ priorityId })
      await upload(send.id)
      await vi.waitFor(async () => {
        expect(await answersOn(send.id)).toHaveLength(2)
      })
      await vi.waitFor(async () => {
        expect(await feedbackOn()).toHaveLength(2)
      })
      return send
    }

    it('records each respondent’s reply as a coded issue, by text', async () => {
      const send = await uploadAndCode()

      const rows = await feedbackOn()
      expect(rows).toEqual([
        expect.objectContaining({
          personId: 'person-no',
          channel: ConstituentFeedbackChannel.text,
          transcript: 'No way',
          clientKey: `priority-text:${send.id}:person-no`,
          actorUserId: service.user.id,
          effortQuestion: CONTRAST_QUESTION,
          extractionStatus: ConstituentFeedbackExtractionStatus.extracted,
          confirmedAt: null,
          // Left off the send, whose report counts replies as replies.
          outreachId: null,
          occurredAt: new Date('2026-10-11T15:10:00.000Z'),
          issues: [
            expect.objectContaining({
              issueLabel: 'Drain fees',
              stance: 'opposes',
              desiredOutcome: 'Keep the fee small',
            }),
          ],
        }),
        expect.objectContaining({
          personId: 'person-yes',
          transcript: 'Yes I would\nas long as it is small',
          occurredAt: new Date('2026-10-11T15:05:00.000Z'),
          issues: [expect.objectContaining({ stance: 'mixed' })],
        }),
      ])

      // Read as the person's own words, against the check's question.
      const prompts = extractionCalls(completion).map(([options]) =>
        options.messages.map((message) => message.content).join('\n'),
      )
      expect(prompts).toHaveLength(2)
      for (const prompt of prompts) {
        expect(prompt).toContain('OWN text reply')
        expect(prompt).toContain(`They were asked: ${CONTRAST_QUESTION}`)
      }

      // The yes or no the priority's read uses is untouched.
      expect((await answersOn(send.id)).map((answer) => answer.code)).toEqual([
        PriorityAnswerCode.no,
        PriorityAnswerCode.yes,
      ])
    })

    it('makes no duplicate when the replies are read again', async () => {
      const send = await uploadAndCode()
      const first = await feedbackOn()
      completion.mockClear()
      const coding = service.app.get(PriorityAnswerCodingService)

      await coding.codeOutreach(send.id)
      await coding.sweep(new Date())

      expect(completion).not.toHaveBeenCalled()
      expect(await feedbackOn()).toEqual(first)
    })

    it('shows on the person’s record as by text', async () => {
      await uploadAndCode()

      const res = await service.client.get('/v1/constituent-feedback', {
        headers: { 'x-organization-slug': slug },
        params: { personId: 'person-no' },
      })

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.feedback).toEqual([
        expect.objectContaining({
          channel: 'text',
          transcript: 'No way',
          confirmedAt: null,
          issues: [
            expect.objectContaining({
              issueLabel: 'Drain fees',
              stance: 'opposes',
              desiredOutcome: 'Keep the fee small',
            }),
          ],
        }),
      ])
    })

    // A text reply has no confirm step, so the sweep that confirms an
    // abandoned one (and drops its unreviewed issues) leaves it alone.
    it('is never confirmed by the abandoned-confirm sweep', async () => {
      await uploadAndCode()
      await service.prisma.$executeRaw`
        UPDATE constituent_feedback
        SET updated_at = now() - interval '3 hours'
        WHERE organization_slug = ${slug}`

      await service.app
        .get(PendingTranscriptionService)
        .pass(new Date(Date.now() + 60_000))

      const rows = await feedbackOn()
      expect(rows.map((row) => row.confirmedAt)).toEqual([null, null])
      expect(rows.map((row) => row.issues.length)).toEqual([1, 1])
    })

    it('reads a reply again after a failed extraction', async () => {
      const send = await createSend({ priorityId })
      completion.mockImplementation(async (options) => {
        if (!isCoding(options)) throw new Error('upstream 529')
        const prompt = String(options.messages[1]?.content)
        return {
          object: {
            answers: repliesIn(prompt).map((reply) => ({
              id: reply.id,
              code: 'yes',
            })),
          },
          model: 'claude-test',
          tokens: 0,
          inputTokens: 0,
          outputTokens: 0,
        }
      })
      await upload(send.id)
      await vi.waitFor(async () => {
        expect(await answersOn(send.id)).toHaveLength(2)
      })
      expect((await feedbackOn()).map((row) => row.extractionStatus)).toEqual([
        ConstituentFeedbackExtractionStatus.failed,
        ConstituentFeedbackExtractionStatus.failed,
      ])

      completion.mockRestore()
      completion = mockClassifier()
      await service.app.get(PriorityAnswerCodingService).codeOutreach(send.id)

      const rows = await feedbackOn()
      expect(rows).toHaveLength(2)
      expect(rows.map((row) => row.extractionStatus)).toEqual([
        ConstituentFeedbackExtractionStatus.extracted,
        ConstituentFeedbackExtractionStatus.extracted,
      ])
    })
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
    expect(codingCalls(completion)).toHaveLength(1)
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
