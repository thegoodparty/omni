import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common'
import type { SynthesisRun } from '@goodparty_org/contracts'
import { addMilliseconds, isAfter } from 'date-fns'
import { Prisma, SynthesisRunStatus, SynthesisScope } from '@/generated/prisma'
import { FeaturesService } from '@/features/services/features.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { isPrismaError } from '@/prisma/util/prismaErrors.util'
import {
  type Effort,
  effortChannel,
  FeedbackReportService,
  hasWords,
  MIN_CONFIRMED_FOR_SYNTHESIS,
  TEXT_CHANNEL,
  textRepliesWhere,
} from './feedbackReport.service'
import { IssueTagSeedService } from './issueTagSeed.service'
import {
  SYNTHESIS_ENGINE,
  type SynthesisEngine,
  type SynthesisMemo,
} from './synthesisEngine'
import { ISSUE_CAPTURE_FLAG } from '../util/issueCaptureFlag.util'

// Per scope, on the button only: the completion trigger fires once, as the
// effort finishes, which is when its report matters most. With the floor,
// this is the cost control on pipeline runs.
export const SYNTHESIS_COOLDOWN_MS = 10 * 60_000

// What a completion trigger expects to hear and keeps quiet about: under
// the floor, or a run already in flight.
const EXPECTED_TRIGGER_REFUSALS: ReadonlySet<number> = new Set([
  HttpStatus.CONFLICT,
  HttpStatus.UNPROCESSABLE_ENTITY,
])

// Prisma names the violated fields or the constraint depending on the
// engine, so match either spelling of the one unique column a run insert
// can trip besides its generated id.
const isActiveKeyConflict = (err: Error): boolean => {
  if (!isPrismaError(err, 'P2002')) return false
  const target = err.meta?.target
  const names = Array.isArray(target) ? target : [target]
  return names.some(
    (name) => typeof name === 'string' && /active_?key/i.test(name),
  )
}

const isWinOrganization = (organizationSlug: string) =>
  !organizationSlug.startsWith('eo-')

@Injectable()
export class FeedbackSynthesisService extends createPrismaBase(
  MODELS.FeedbackSynthesisRun,
) {
  constructor(
    @Inject(SYNTHESIS_ENGINE) private readonly engine: SynthesisEngine,
    private readonly report: FeedbackReportService,
    private readonly tagSeed: IssueTagSeedService,
    private readonly features: FeaturesService,
  ) {
    super()
  }

  async requestRun(input: {
    organizationSlug: string
    outreachId: number
    requestedByUserId: number | null
    trigger: 'button' | 'completion'
  }): Promise<SynthesisRun> {
    const { organizationSlug, outreachId } = input
    const effort = await this.report.findEffort(organizationSlug, outreachId)
    const memos = await this.loadMemos(organizationSlug, effort)
    if (memos.length < MIN_CONFIRMED_FOR_SYNTHESIS) {
      throw new UnprocessableEntityException({
        message: 'Not enough confirmed notes to summarize',
        confirmed: memos.length,
        required: MIN_CONFIRMED_FOR_SYNTHESIS,
      })
    }

    if (input.trigger === 'button') {
      const lastCompleted = await this.findFirst({
        where: {
          organizationSlug,
          outreachId,
          status: SynthesisRunStatus.completed,
        },
        orderBy: { completedAt: Prisma.SortOrder.desc },
        select: { completedAt: true },
      })
      if (
        lastCompleted?.completedAt &&
        isAfter(
          addMilliseconds(lastCompleted.completedAt, SYNTHESIS_COOLDOWN_MS),
          new Date(),
        )
      ) {
        throw new HttpException(
          'This effort was summarized moments ago',
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }
    }

    if (
      isWinOrganization(organizationSlug) &&
      (await this.count({ where: { organizationSlug } })) === 0
    ) {
      await this.tagSeed.seedFromPositions(organizationSlug)
    }

    const denominators = await this.report.denominators(
      organizationSlug,
      effort,
    )
    // No read-then-insert check for a run in flight: the unique activeKey
    // is the guard, so the report's button and the completion trigger
    // racing each other cannot both start one.
    const run = await this.model
      .create({
        data: {
          organizationSlug,
          scope: SynthesisScope.effort,
          outreachId,
          status: SynthesisRunStatus.running,
          activeKey: `${organizationSlug}:${outreachId}`,
          conversations: denominators.conversations,
          memos: denominators.memos,
          // What the engine is handed, not every confirmed memo: a caption
          // over this run must not claim more input than it had.
          confirmed: memos.length,
          engine: this.engine.name,
          requestedByUserId: input.requestedByUserId,
        },
      })
      .catch((err: Error) => {
        if (isActiveKeyConflict(err)) {
          throw new ConflictException('This effort is already being summarized')
        }
        throw err
      })

    this.logger.info(
      {
        runId: run.id,
        scope: run.scope,
        outreachId,
        inputCount: memos.length,
        engine: run.engine,
      },
      'Feedback synthesis requested',
    )

    await this.engine.start(run, memos)

    const started = await this.model.findUniqueOrThrow({
      where: { id: run.id },
    })
    return {
      id: started.id,
      status: started.status,
      createdAt: started.createdAt,
      completedAt: started.completedAt,
      engine: started.engine,
    }
  }

  // What the engine groups, oldest first, keyed so the ingest can find each
  // one again: a memo's own id, or a reply's. On a turf or a list, confirmed
  // memos only: one nobody with first-hand knowledge has checked never
  // enters a theme, and one confirmed by hand after its recording failed
  // has no words and would be an empty row in the CSV. On a text send, the
  // replies constituents wrote, minus opt-outs and empty bodies; a reply is
  // the constituent's own words and needs no confirming.
  private async loadMemos(
    organizationSlug: string,
    effort: Effort,
  ): Promise<SynthesisMemo[]> {
    if (effortChannel(effort) === TEXT_CHANNEL) {
      const replies = await this.client.pollIndividualMessage.findMany({
        where: textRepliesWhere(effort.id),
        orderBy: [
          { sentAt: Prisma.SortOrder.asc },
          { id: Prisma.SortOrder.asc },
        ],
        select: { id: true, content: true, sentAt: true },
      })
      return replies.filter(hasWords).map(({ id, content, sentAt }) => ({
        id,
        text: content,
        occurredAt: sentAt,
      }))
    }
    const rows = await this.client.constituentFeedback.findMany({
      where: {
        organizationSlug,
        outreachId: effort.id,
        confirmedAt: { not: null },
        transcript: { not: null },
      },
      orderBy: { occurredAt: Prisma.SortOrder.asc },
      select: { id: true, transcript: true, occurredAt: true },
    })
    return rows.flatMap(({ id, transcript, occurredAt }) =>
      transcript === null ? [] : [{ id, text: transcript, occurredAt }],
    )
  }

  // Fire-and-forget from the paths that complete an effort: the turf's
  // Done, the phone list's last call, and a text send's results landing.
  // The press, the call or the upload has already succeeded, so nothing
  // here can fail it.
  requestRunOnEffortCompleted(input: {
    organizationSlug: string
    outreachId: number
  }): void {
    this.runIfRolledOut(input).catch((err: Error) => {
      if (
        err instanceof HttpException &&
        EXPECTED_TRIGGER_REFUSALS.has(err.getStatus())
      ) {
        return
      }
      this.logger.error(
        { err, ...input },
        'Synthesis on effort completion failed',
      )
    })
  }

  // The routes are flag-gated per request; this path has no request, so it
  // asks for the org's owner, the same subject the completion event uses.
  // Turning the flag off has to stop the automatic runs too. Most
  // completed efforts have no memos at all, so the floor is checked first
  // and keeps a flag lookup off nearly every turf's Done.
  private async runIfRolledOut(input: {
    organizationSlug: string
    outreachId: number
  }): Promise<void> {
    const effort = await this.report.findEffort(
      input.organizationSlug,
      input.outreachId,
    )
    const memos = await this.loadMemos(input.organizationSlug, effort)
    if (memos.length < MIN_CONFIRMED_FOR_SYNTHESIS) return

    const { ownerId } = await this.client.organization.findUniqueOrThrow({
      where: { slug: input.organizationSlug },
      select: { ownerId: true },
    })
    const enabled = await this.features.isFeatureEnabled({
      user: ownerId,
      feature: ISSUE_CAPTURE_FLAG,
    })
    if (!enabled) return
    await this.requestRun({
      ...input,
      requestedByUserId: null,
      trigger: 'completion',
    })
  }
}
