import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { isAfter, subDays } from 'date-fns'
import { z } from 'zod'
import {
  parsePriorityStatus,
  PriorityCheckSideSchema,
  PriorityStepIdSchema,
} from '@goodparty_org/contracts'
import {
  DoorKnockOutcome,
  OutreachStatus,
  OutreachType,
  PhoneBankCallOutcome,
  PollIndividualMessageSender,
  PriorityAnswerCode,
  PriorityAnswerSource,
  Prisma,
  type Priority,
} from '@/generated/prisma'
import { CronLockService } from '@/cron/services/cronLock.service'
import { LlmService } from '@/llm/services/llm.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'

const SWEEP_JOB = 'priorityAnswerCodingSweep'
const SWEEP_CRON = '6,16,26,36,46,56 * * * *'
const SWEEP_WINDOW_DAYS = 30

// Enough replies per call to keep a send's coding to a handful of calls,
// few enough that one bad response loses little and the prompt stays short.
const CODING_BATCH_SIZE = 20

const CODED_OUTREACH_TYPES: OutreachType[] = [
  OutreachType.text,
  OutreachType.nativePhoneBanking,
  OutreachType.nativeDoorKnocking,
]

// The same sends PriorityResultsService counts answers on.
const PRIORITY_SEND_WHERE = {
  priorityId: { not: null },
  campaignId: null,
  organizationSlug: { not: null },
  outreachType: { in: CODED_OUTREACH_TYPES },
  status: {
    notIn: [
      OutreachStatus.pending_payment,
      OutreachStatus.draft,
      OutreachStatus.canceled,
    ],
  },
} satisfies Prisma.OutreachWhereInput

export type ReplyKind = 'text_reply' | 'conversation_note'

export type CodingReply = {
  ref: string
  kind: ReplyKind
  text: string
}

type PendingAnswer = {
  personId: string
  source: PriorityAnswerSource
  sourceId: string
  text: string
  changedAt: Date
}

// Looser than PriorityAnswerCode on purpose: an off-vocabulary code drops
// that one reply, to be read again on the next pass, instead of failing the
// batch.
const RawCodingSchema = z.object({
  answers: z.array(z.object({ id: z.string(), code: z.string() })),
})

export type RawCoding = z.infer<typeof RawCodingSchema>

const CODE_BY_VALUE: Record<string, PriorityAnswerCode | undefined> =
  Object.fromEntries(
    Object.values(PriorityAnswerCode).map((code) => [code, code]),
  )

const KIND_BY_SOURCE: Record<PriorityAnswerSource, ReplyKind> = {
  [PriorityAnswerSource.text]: 'text_reply',
  [PriorityAnswerSource.phone_banking]: 'conversation_note',
  [PriorityAnswerSource.door_knocking]: 'conversation_note',
}

export const CODING_SYSTEM_PROMPT = `You code replies to one question that a
local elected office asked residents. For each reply, decide how it answers
THAT question and give exactly one code:

"yes": the reply answers the question in the affirmative: agrees, supports,
confirms, or says it is true for them.
"no": the reply answers the question in the negative: disagrees, opposes,
denies, or says it is not true for them.
"mixed": the reply answers the question, but both ways or with a condition
that splits it, such as backing one part and opposing another.
"not_an_answer": the reply does not answer the question. A different topic,
a question back, a greeting or thanks, a request to stop messaging, or too
unclear to call.

Each reply has a kind. A "text_reply" is the resident's own words. A
"conversation_note" is what a canvasser or caller wrote down after talking
with the resident, in the note-taker's voice: "He is against the new fee"
means the resident is against it. Code what the RESIDENT said, never the
note-taker's own view.

Read each reply only against the question. Do not guess from tone, from who
the resident might be, or from what most people would say. A reply that
raises a related concern without answering is "not_an_answer". When you are
torn between an answer and "not_an_answer", choose "not_an_answer".

Return answers: one entry per reply, with its id exactly as given and its
code.`

export const buildCodingPrompt = (
  question: string,
  replies: CodingReply[],
): string =>
  `The question: ${question}\n\nThe replies, as JSON:\n${JSON.stringify(
    replies.map(({ ref, kind, text }) => ({ id: ref, kind, text })),
  )}`

// Only refs this batch sent are kept, and the first code for a ref wins, so a
// model that invents or repeats an id cannot code someone it was not shown.
export const parseCoding = (
  raw: RawCoding,
  refs: string[],
): Map<string, PriorityAnswerCode> => {
  const asked = new Set(refs)
  const codes = new Map<string, PriorityAnswerCode>()
  for (const { id, code } of raw.answers) {
    const known = CODE_BY_VALUE[code.trim().toLowerCase()]
    if (known !== undefined && asked.has(id) && !codes.has(id)) {
      codes.set(id, known)
    }
  }
  return codes
}

// Codes each respondent's free-text answer on a priority send against the
// question that send put out. The hooks (a text send's results upload, a
// door or call memo captured or confirmed) code a send as soon as there is
// something to read; the sweep is the backstop for a hook that failed or a
// model call that did not answer.
//
// No deploy allowlist on the sweep: it calls the model only for replies on
// its own database, the reasoning pendingTranscription.service.ts gives.
@Injectable()
export class PriorityAnswerCodingService extends createPrismaBase(
  MODELS.PriorityAnswer,
) {
  constructor(
    private readonly llm: LlmService,
    private readonly cronLock: CronLockService,
  ) {
    super()
  }

  // Fire-and-forget for a write path that has already committed: nothing
  // here may fail it.
  codeOutreachInBackground(outreachId: number): void {
    this.codeOutreach(outreachId).catch((err: Error) => {
      this.logger.error({ err, outreachId }, 'Priority answer coding failed')
    })
  }

  @Cron(SWEEP_CRON, { name: SWEEP_JOB, timeZone: EASTERN_TIMEZONE })
  async sweepUncodedAnswers(): Promise<void> {
    await this.sweep(new Date())
  }

  async sweep(now: Date): Promise<void> {
    // Read before claiming, so a deploy with no priority sends writes no
    // cron_run row.
    const sends = await this.client.outreach.findMany({
      where: {
        ...PRIORITY_SEND_WHERE,
        createdAt: { gte: subDays(now, SWEEP_WINDOW_DAYS) },
      },
      select: { id: true },
    })
    if (sends.length === 0) return
    if (!(await this.cronLock.tryClaimTenMinuteRun(SWEEP_JOB, now))) return

    try {
      for (const { id } of sends) {
        try {
          await this.codeOutreach(id)
        } catch (err) {
          this.logger.error(
            { err, outreachId: id },
            'Priority answer sweep failed on a send; continuing',
          )
        }
      }
    } finally {
      await this.cronLock.markTenMinuteCompleted(SWEEP_JOB, now)
    }
  }

  // Codes every respondent with words who has no code yet, or whose words
  // changed after they were coded. Returns how many were written.
  async codeOutreach(outreachId: number): Promise<number> {
    const outreach = await this.client.outreach.findFirst({
      where: { id: outreachId, ...PRIORITY_SEND_WHERE },
      select: {
        id: true,
        organizationSlug: true,
        outreachType: true,
        message: true,
        priorityStepId: true,
        priorityCheckSide: true,
        phoneBankingListId: true,
        priority: { select: { status: true } },
        doorKnockingTurf: { select: { communityInputQuestion: true } },
        phoneBankingList: { select: { communityInputQuestion: true } },
      },
    })
    if (outreach === null || outreach.organizationSlug === null) return 0
    const organizationSlug = outreach.organizationSlug

    const respondents = await this.respondentsWithWords({
      ...outreach,
      organizationSlug,
    })
    const pending = await this.pendingOf(
      organizationSlug,
      outreachId,
      respondents,
    )
    if (pending.length === 0) return 0

    const question = this.questionOf(outreach)
    if (question === null) {
      this.logger.warn(
        { outreachId, pending: pending.length },
        'Priority send has no question to code answers against',
      )
      return 0
    }

    let written = 0
    for (let at = 0; at < pending.length; at += CODING_BATCH_SIZE) {
      written += await this.codeBatch({
        organizationSlug,
        outreachId,
        question,
        batch: pending.slice(at, at + CODING_BATCH_SIZE),
      })
    }
    return written
  }

  // The check the send put out, on the side it put out. A send linked to a
  // priority with no check, or a check with no question, falls back to what
  // the resident was actually asked on that channel.
  private questionOf(outreach: {
    outreachType: OutreachType
    message: string | null
    priorityStepId: string | null
    priorityCheckSide: string | null
    priority: Pick<Priority, 'status'> | null
    doorKnockingTurf: { communityInputQuestion: string | null } | null
    phoneBankingList: { communityInputQuestion: string | null } | null
  }): string | null {
    const stepId = PriorityStepIdSchema.safeParse(outreach.priorityStepId)
    const side = PriorityCheckSideSchema.safeParse(outreach.priorityCheckSide)
    const check =
      stepId.success && outreach.priority !== null
        ? parsePriorityStatus(outreach.priority.status).steps.find(
            (step) => step.id === stepId.data,
          )?.check
        : undefined
    const fromCheck =
      side.success && side.data === 'contrast'
        ? check?.contrast?.question
        : check?.question
    const asked =
      outreach.outreachType === OutreachType.text
        ? outreach.message
        : (outreach.doorKnockingTurf?.communityInputQuestion ??
          outreach.phoneBankingList?.communityInputQuestion)
    const question = [fromCheck, asked]
      .map((value) => value?.trim() ?? '')
      .find((value) => value !== '')
    return question ?? null
  }

  // Who answered, as PriorityResultsService counts them, with their words.
  // Someone who answered and left no words (a knock with no memo, a reply
  // with an empty body) is left uncoded: there is nothing to read.
  private async respondentsWithWords(outreach: {
    id: number
    organizationSlug: string
    outreachType: OutreachType
    phoneBankingListId: number | null
  }): Promise<PendingAnswer[]> {
    if (outreach.outreachType === OutreachType.text) {
      const replies = await this.client.pollIndividualMessage.findMany({
        where: {
          outreachId: outreach.id,
          sender: PollIndividualMessageSender.CONSTITUENT,
          NOT: { isOptOut: true },
        },
        orderBy: { sentAt: Prisma.SortOrder.asc },
        select: { personId: true, content: true, updatedAt: true },
      })
      const byPerson = new Map<string, { lines: string[]; changedAt: Date }>()
      for (const reply of replies) {
        const held = byPerson.get(reply.personId) ?? {
          lines: [],
          changedAt: reply.updatedAt,
        }
        const line = reply.content?.trim() ?? ''
        byPerson.set(reply.personId, {
          lines: line === '' ? held.lines : [...held.lines, line],
          changedAt: isAfter(reply.updatedAt, held.changedAt)
            ? reply.updatedAt
            : held.changedAt,
        })
      }
      return [...byPerson].flatMap(([personId, { lines, changedAt }]) =>
        lines.length === 0
          ? []
          : [
              {
                personId,
                source: PriorityAnswerSource.text,
                sourceId: `${outreach.id}:${personId}`,
                text: lines.join('\n'),
                changedAt,
              },
            ],
      )
    }

    const memo = {
      constituentFeedback: { select: { transcript: true, updatedAt: true } },
    } as const
    const rows =
      outreach.outreachType === OutreachType.nativePhoneBanking
        ? outreach.phoneBankingListId === null
          ? []
          : await this.client.contactInteractionPhoneBanking.findMany({
              where: {
                phoneBankingListId: outreach.phoneBankingListId,
                outcome: PhoneBankCallOutcome.answered,
              },
              select: { id: true, personId: true, ...memo },
            })
        : await this.client.contactInteractionDoorKnock.findMany({
            where: {
              organizationSlug: outreach.organizationSlug,
              outreachId: outreach.id,
              outcome: DoorKnockOutcome.answered,
            },
            select: { id: true, personId: true, ...memo },
          })
    const source =
      outreach.outreachType === OutreachType.nativePhoneBanking
        ? PriorityAnswerSource.phone_banking
        : PriorityAnswerSource.door_knocking
    return rows.flatMap((row) => {
      const text = row.constituentFeedback?.transcript?.trim() ?? ''
      return row.constituentFeedback === null || text === ''
        ? []
        : [
            {
              personId: row.personId,
              source,
              sourceId: row.id,
              text,
              changedAt: row.constituentFeedback.updatedAt,
            },
          ]
    })
  }

  private async pendingOf(
    organizationSlug: string,
    outreachId: number,
    respondents: PendingAnswer[],
  ): Promise<PendingAnswer[]> {
    if (respondents.length === 0) return []
    const coded = await this.model.findMany({
      where: { organizationSlug, outreachId },
      select: { source: true, sourceId: true, codedAt: true },
    })
    const codedAt = new Map(
      coded.map((row) => [`${row.source}:${row.sourceId}`, row.codedAt]),
    )
    return respondents.filter((respondent) => {
      const at = codedAt.get(`${respondent.source}:${respondent.sourceId}`)
      return at === undefined || isAfter(respondent.changedAt, at)
    })
  }

  private async codeBatch(input: {
    organizationSlug: string
    outreachId: number
    question: string
    batch: PendingAnswer[]
  }): Promise<number> {
    // Taken before the call, so words that land while the model is reading
    // are newer than the code and get read on the next pass.
    const codedAt = new Date()
    // Positions, never person ids: the model needs a handle, not an identity.
    const replies = input.batch.map((answer, index) => ({
      ref: String(index + 1),
      kind: KIND_BY_SOURCE[answer.source],
      text: answer.text,
    }))
    const coded = await this.classify(input.question, replies, {
      organizationSlug: input.organizationSlug,
      outreachId: input.outreachId,
    })
    if (coded === null) return 0
    const codes = parseCoding(
      coded.raw,
      replies.map(({ ref }) => ref),
    )
    if (codes.size < replies.length) {
      this.logger.warn(
        {
          outreachId: input.outreachId,
          asked: replies.length,
          coded: codes.size,
        },
        'Priority answer coding left some replies uncoded',
      )
    }

    let written = 0
    for (const [index, answer] of input.batch.entries()) {
      const code = codes.get(String(index + 1))
      if (code === undefined) continue
      await this.model.upsert({
        where: {
          organizationSlug_source_sourceId: {
            organizationSlug: input.organizationSlug,
            source: answer.source,
            sourceId: answer.sourceId,
          },
        },
        create: {
          organizationSlug: input.organizationSlug,
          outreachId: input.outreachId,
          personId: answer.personId,
          source: answer.source,
          sourceId: answer.sourceId,
          code,
          model: coded.model,
          codedAt,
        },
        update: {
          outreachId: input.outreachId,
          personId: answer.personId,
          code,
          model: coded.model,
          codedAt,
        },
      })
      written += 1
    }
    return written
  }

  // Null rather than throwing, as ConstituentFeedbackExtractionService does:
  // the replies stay uncoded and the next pass reads them again.
  private async classify(
    question: string,
    replies: CodingReply[],
    context: { organizationSlug: string; outreachId: number },
  ): Promise<{ raw: RawCoding; model: string } | null> {
    try {
      const { object, model } = await this.llm.jsonCompletion({
        schema: RawCodingSchema,
        messages: [
          { role: 'system', content: CODING_SYSTEM_PROMPT },
          { role: 'user', content: buildCodingPrompt(question, replies) },
        ],
      })
      return { raw: object, model }
    } catch (err) {
      this.logger.error(
        { err, ...context, replies: replies.length },
        'Priority answer classification failed',
      )
      return null
    }
  }
}
