import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import {
  AudioUploadUrlResponse,
  CONSTITUENT_FEEDBACK_AUDIO_MAX_BYTES,
  CONSTITUENT_FEEDBACK_DESIRED_OUTCOME_MAX_LENGTH,
  CONSTITUENT_FEEDBACK_ISSUE_LABEL_MAX_LENGTH,
  CONSTITUENT_FEEDBACK_MAX_ISSUES,
  CONSTITUENT_FEEDBACK_TRANSCRIPT_MAX_LENGTH,
  ConfirmConstituentFeedback,
  ConstituentFeedbackIssue,
  ConstituentFeedbackRecord,
  RecordConstituentFeedback,
  RecordConstituentFeedbackResponse,
} from '@goodparty_org/contracts'
import {
  ConstituentFeedbackCaptureMethod,
  ConstituentFeedbackChannel,
  ConstituentFeedbackConfirmation,
  ConstituentFeedbackExtractionStatus,
  ConstituentFeedbackStance,
  IssueTagStatus,
  OrganizationRole,
  Prisma,
} from '@/generated/prisma'
import { AnalyticsService } from '@/analytics/analytics.service'
import { assertVolunteerAssignedToOutreach } from '@/doorKnocking/utils/doorKnockingAccess.util'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { PriorityAnswerCodingService } from '@/priorities/services/priorityAnswerCoding.service'
import { APP_ROOT, WEBAPP_API_PATH } from '@/shared/util/appEnvironment.util'
import { TranscribeFileService } from '@/speech/services/transcribeFile.service'
import { SPEECH_BUCKET } from '@/speech/speechBucket'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { isDevOnlyRouteEnabled } from '../util/devOnlyRoute.util'
import {
  ConstituentFeedbackExtractionService,
  RawExtraction,
} from './constituentFeedbackExtraction.service'

// The model is told to answer short and nearly always does, but nothing
// makes it. The contract caps these two at 120 and 1000, and the response
// interceptor enforces that cap on the way out — so an overlong string would
// save the row and then 500 the request that saved it, leaving the canvasser
// looking at a capture failure for a memo that is safely on disk. Truncating
// keeps the record; the untruncated text stays in `proposed*` and in the
// transcript, so nothing the model said is actually lost.
const clamp = (value: string, max: number): string => value.slice(0, max)

type ExtractionFields = {
  extractionStatus: ConstituentFeedbackExtractionStatus
  extractionConfidence: number | null
  extractionModel: string | null
}

type IssueRow = {
  position: number
  issueLabel: string
  stance: ConstituentFeedbackStance | null
  desiredOutcome: string | null
  proposedIssueLabel: string | null
  proposedStance: string | null
  proposedDesiredOutcome: string | null
}

type Extracted = { extraction: RawExtraction; model: string } | null

const EMPTY_EXTRACTION = {
  extractionConfidence: null,
  extractionModel: null,
} as const satisfies Omit<ExtractionFields, 'extractionStatus'>

type CaptureTarget = {
  personId: string
  doorKnockInteractionId: string | null
  phoneBankingInteractionId: string | null
  effortQuestion: string | null
  outreachId: number | null
}

const STANCE_BY_VALUE: Record<string, ConstituentFeedbackStance | undefined> =
  Object.fromEntries(
    Object.values(ConstituentFeedbackStance).map((stance) => [stance, stance]),
  )

// The model is prompted for one of these but is not bound to them, so an
// off-vocabulary answer becomes a null stance while `proposedStance` keeps
// what it actually said.
const toStance = (raw: string | null): ConstituentFeedbackStance | null =>
  raw === null ? null : (STANCE_BY_VALUE[raw] ?? null)

// Until someone confirms them, the confirmed columns hold the model's
// answer as the surface can show it, and `proposed*` what it actually said.
// The model is asked for at most five named issues and bound to neither: a
// blank label is nothing anyone could confirm, and the ones past five are
// dropped rather than failing the whole extraction.
const proposedIssues = (extracted: Extracted): IssueRow[] =>
  extracted === null
    ? []
    : extracted.extraction.issues
        .filter((issue) => issue.issueLabel.trim() !== '')
        .slice(0, CONSTITUENT_FEEDBACK_MAX_ISSUES)
        .map((issue, position) => ({
          position,
          issueLabel: clamp(
            issue.issueLabel,
            CONSTITUENT_FEEDBACK_ISSUE_LABEL_MAX_LENGTH,
          ),
          stance: toStance(issue.stance),
          desiredOutcome:
            issue.desiredOutcome === null
              ? null
              : clamp(
                  issue.desiredOutcome,
                  CONSTITUENT_FEEDBACK_DESIRED_OUTCOME_MAX_LENGTH,
                ),
          proposedIssueLabel: issue.issueLabel,
          proposedStance: issue.stance,
          proposedDesiredOutcome: issue.desiredOutcome,
        }))

const ISSUE_SELECT = {
  orderBy: { position: Prisma.SortOrder.asc },
  select: {
    id: true,
    position: true,
    issueLabel: true,
    stance: true,
    desiredOutcome: true,
  },
} as const satisfies Prisma.ConstituentFeedbackIssueFindManyArgs

// Two statements rather than one nested write, so the delete is certain to
// land before the insert, which would otherwise collide on
// (feedbackId, position).
const replaceIssues = async (
  tx: Prisma.TransactionClient,
  feedbackId: string,
  issues: IssueRow[],
): Promise<ConstituentFeedbackIssue[]> => {
  await tx.constituentFeedbackIssue.deleteMany({ where: { feedbackId } })
  if (issues.length === 0) return []
  const created = await tx.constituentFeedbackIssue.createManyAndReturn({
    data: issues.map((issue) => ({ ...issue, feedbackId })),
    select: ISSUE_SELECT.select,
  })
  return created.sort((a, b) => a.position - b.position)
}

type ProposedFields = Pick<
  IssueRow,
  'proposedIssueLabel' | 'proposedStance' | 'proposedDesiredOutcome'
>

// The model's own words for each issue it proposed, in order. An issue a
// person wrote has no proposal, so it is left out.
const replaceUnreviewedProposal = async (
  tx: Prisma.TransactionClient,
  feedbackId: string,
  issues: ProposedFields[],
): Promise<void> => {
  await tx.constituentFeedbackUnreviewedIssue.deleteMany({
    where: { feedbackId },
  })
  const proposal = issues.flatMap((issue) =>
    issue.proposedIssueLabel === null
      ? []
      : [
          {
            issueLabel: issue.proposedIssueLabel,
            stance: issue.proposedStance,
            desiredOutcome: issue.proposedDesiredOutcome,
          },
        ],
  )
  if (proposal.length === 0) return
  await tx.constituentFeedbackUnreviewedIssue.createMany({
    data: proposal.map((issue, position) => ({
      ...issue,
      position,
      feedbackId,
    })),
  })
}

// Confirming without review leaves a memo no issues, so nothing that reads
// them can count a guess nobody checked. The model's proposal moves to the
// unreviewed proposal, kept only to measure extraction. A memo with nothing
// proposed keeps whatever proposal it already has.
const setAsideProposal = async (
  tx: Prisma.TransactionClient,
  feedbackId: string,
): Promise<void> => {
  const proposed = await tx.constituentFeedbackIssue.findMany({
    where: { feedbackId, proposedIssueLabel: { not: null } },
    orderBy: { position: Prisma.SortOrder.asc },
    select: {
      proposedIssueLabel: true,
      proposedStance: true,
      proposedDesiredOutcome: true,
    },
  })
  if (proposed.length > 0) {
    await replaceUnreviewedProposal(tx, feedbackId, proposed)
  }
  await tx.constituentFeedbackIssue.deleteMany({ where: { feedbackId } })
}

// What a person's record reads with each memo. Accepted tags only: a
// proposal is a suggestion nobody has agreed to yet.
const RECORD_INCLUDE = {
  issues: ISSUE_SELECT,
  actor: { select: { firstName: true, lastName: true } },
  tags: {
    where: { tag: { status: IssueTagStatus.accepted } },
    select: { tag: { select: { id: true, name: true, status: true } } },
  },
} as const satisfies Prisma.ConstituentFeedbackInclude

// Long enough to cover a slow upload on one bar of signal, short enough that
// a leaked URL is not a standing write into the bucket.
const AUDIO_UPLOAD_EXPIRES_SECONDS = 15 * 60

const AUDIO_PREFIX = 'constituent-feedback'

// One recording per memo, named by the memo's own replay key, so a re-sent
// upload lands on the same object and the key cannot name another org's.
// `.webm` even for Safari's mp4: Transcribe reads the container, not the name.
const audioKeyFor = (organizationSlug: string, clientKey: string): string =>
  `${AUDIO_PREFIX}/${organizationSlug}/${clientKey}.webm`

// What each channel's own write route tells a volunteer outside their
// assignment, so the memo routes never say more than the knock or call did.
const NOT_ASSIGNED_MESSAGE: Record<ConstituentFeedbackChannel, string> = {
  door_knock: 'Stop target not found',
  phone_bank: 'Phone banking list not found',
  text: 'Not found',
}

// One row per resident per priority text send, so reading the same replies
// again lands on the row it wrote the first time.
export const textReplyClientKey = (
  outreachId: number,
  personId: string,
): string => `priority-text:${outreachId}:${personId}`

// The webapp's capture events report these channels as doorKnocking and
// phoneBanking, and a text send as sms, so one channel is one value across
// every Issue Capture event, browser or server.
const ANALYTICS_CHANNEL: Record<ConstituentFeedbackChannel, string> = {
  door_knock: 'doorKnocking',
  phone_bank: 'phoneBanking',
  text: 'sms',
}

// Transcribe's own failure reason is free text, so the event carries one of
// four values a chart can group by, never the vendor's message.
const TRANSCRIPTION_FAILURE_REASONS = [
  'start_failed',
  'empty_transcript',
  'timeout',
] as const
const transcriptionFailureReason = (reason: string): string =>
  TRANSCRIPTION_FAILURE_REASONS.find((known) => known === reason) ??
  'job_failed'

export type PriorityTextReply = {
  personId: string
  text: string
  repliedAt: Date
}

@Injectable()
export class ConstituentFeedbackService extends createPrismaBase(
  MODELS.ConstituentFeedback,
) {
  constructor(
    private readonly extraction: ConstituentFeedbackExtractionService,
    private readonly moduleRef: ModuleRef,
    private readonly transcribeFile: TranscribeFileService,
    private readonly s3: S3Service,
    private readonly analytics: AnalyticsService,
  ) {
    super()
  }

  // Where the phone puts a memo it recorded with no signal: a presigned POST,
  // whose policy pins the type and caps the size, so S3 refuses a runaway
  // recording at upload time. In mock mode the URL is gp-api's own sink,
  // reached through the webapp's `/api` proxy the way every other browser
  // call is, so a laptop needs no bucket.
  async audioUploadUrl(input: {
    organizationSlug: string
    clientKey: string
    contentType: string
  }): Promise<AudioUploadUrlResponse> {
    const audioKey = audioKeyFor(input.organizationSlug, input.clientKey)
    const expiresAt = new Date(Date.now() + AUDIO_UPLOAD_EXPIRES_SECONDS * 1000)
    if (this.transcribeFile.mode === 'mock') {
      return {
        audioKey,
        uploadUrl: `${APP_ROOT}${WEBAPP_API_PATH}constituent-feedback/audio-upload/${input.clientKey}`,
        fields: {},
        expiresAt,
      }
    }
    const { url, fields } = await this.s3.createPresignedUpload(
      SPEECH_BUCKET,
      audioKey,
      {
        expiresIn: AUDIO_UPLOAD_EXPIRES_SECONDS,
        contentType: input.contentType,
        maxBytes: CONSTITUENT_FEEDBACK_AUDIO_MAX_BYTES,
      },
    )
    return { audioKey, uploadUrl: url, fields, expiresAt }
  }

  // The mock sink takes the bytes and keeps none. It exists only in mock
  // mode on a dev-only deploy.
  acceptMockUpload(): void {
    if (this.transcribeFile.mode !== 'mock' || !isDevOnlyRouteEnabled()) {
      throw new NotFoundException()
    }
  }

  async capture(input: {
    organizationSlug: string
    actorUserId: number
    role: OrganizationRole | undefined
    body: RecordConstituentFeedback
  }): Promise<RecordConstituentFeedbackResponse> {
    const target =
      input.body.channel === ConstituentFeedbackChannel.door_knock
        ? await this.resolveKnock(
            input.organizationSlug,
            input.body.knockClientKey,
            input.body.stopTargetId,
          )
        : await this.resolvePhoneBankCall(
            input.organizationSlug,
            input.body.entryId,
            input.body.personId,
          )

    // Before extraction, so a refused volunteer costs no model call.
    await this.assertVolunteerOnEffort(
      input.role,
      target.outreachId,
      input.actorUserId,
      input.body.channel,
    )

    const { transcript, audioKey } = input.body
    if (audioKey !== undefined) {
      return this.captureRecording({ ...input, audioKey, target })
    }
    // The contract's refine guarantees one of the two.
    if (transcript === undefined) {
      throw new BadRequestException('Send a transcript or an audioKey')
    }

    const extracted = await this.extraction.extract({
      transcript,
      effortQuestion: target.effortQuestion,
      userId: input.actorUserId,
    })

    const where = await this.upsertKey(
      input.organizationSlug,
      target,
      input.body,
    )
    const { row, issues } = await this.client.$transaction(async (tx) => {
      const saved = await tx.constituentFeedback.upsert({
        where,
        create: {
          organizationSlug: input.organizationSlug,
          clientKey: input.body.clientKey,
          personId: target.personId,
          occurredAt: new Date(),
          actorUserId: input.actorUserId,
          channel: input.body.channel,
          captureMethod: input.body.captureMethod,
          transcript,
          effortQuestion: target.effortQuestion,
          outreachId: target.outreachId,
          doorKnockInteractionId: target.doorKnockInteractionId,
          phoneBankingInteractionId: target.phoneBankingInteractionId,
          ...this.extractionFields(extracted),
        },
        // A re-record REPLACES the issues with a fresh model proposal, so any
        // confirmation the old ones earned is void. Leaving `confirmedAt` set
        // would hand reporting a model guess wearing a human's signature,
        // which is the one thing the column exists to prevent.
        update: {
          transcript,
          captureMethod: input.body.captureMethod,
          // A live re-record replaces an offline one outright.
          audioKey: null,
          transcriptionJobName: null,
          // Re-read, not left at the first recording's value: the effort's
          // question can be edited between the two, and `extract()` above
          // always runs against the current one. Keeping the old copy here
          // would leave the row claiming a prompt the extraction never saw.
          effortQuestion: target.effortQuestion,
          outreachId: target.outreachId,
          confirmedAt: null,
          confirmation: null,
          ...this.extractionFields(extracted),
        },
      })
      await replaceUnreviewedProposal(tx, saved.id, [])
      return {
        row: saved,
        issues: await replaceIssues(tx, saved.id, proposedIssues(extracted)),
      }
    })
    this.codePriorityAnswers(row.outreachId)

    return {
      id: row.id,
      personId: row.personId,
      extractionStatus: row.extractionStatus,
      extraction: extracted === null ? null : { issues },
    }
  }

  // The offline path. The phone recorded with no signal and has since put
  // the audio at `audioKey`, so there are no words yet: the row is saved
  // pending, a Transcribe job starts, and the pending-transcription cron
  // writes the transcript, runs extraction and confirms the memo when the
  // job finishes. Nobody is at the door any more to check the issues.
  private async captureRecording(input: {
    organizationSlug: string
    actorUserId: number
    body: RecordConstituentFeedback
    audioKey: string
    target: CaptureTarget
  }): Promise<RecordConstituentFeedbackResponse> {
    if (
      input.audioKey !==
      audioKeyFor(input.organizationSlug, input.body.clientKey)
    ) {
      throw new BadRequestException('audioKey does not belong to this memo')
    }
    const { target } = input
    const pending = {
      transcript: null,
      audioKey: input.audioKey,
      transcriptionJobName: null,
      captureMethod: ConstituentFeedbackCaptureMethod.dictation_offline,
      effortQuestion: target.effortQuestion,
      outreachId: target.outreachId,
      confirmedAt: null,
      confirmation: null,
      transcriptionAttempts: 0,
      ...EMPTY_EXTRACTION,
      extractionStatus: ConstituentFeedbackExtractionStatus.pending,
    }

    const where = await this.upsertKey(
      input.organizationSlug,
      target,
      input.body,
    )
    const row = await this.client.$transaction(async (tx) => {
      const saved = await tx.constituentFeedback.upsert({
        where,
        create: {
          organizationSlug: input.organizationSlug,
          clientKey: input.body.clientKey,
          personId: target.personId,
          occurredAt: new Date(),
          actorUserId: input.actorUserId,
          channel: input.body.channel,
          doorKnockInteractionId: target.doorKnockInteractionId,
          phoneBankingInteractionId: target.phoneBankingInteractionId,
          ...pending,
        },
        // Same rule as a live re-record: whatever was confirmed before is
        // void, and so are the issues it was confirmed with.
        update: pending,
      })
      await replaceIssues(tx, saved.id, [])
      await replaceUnreviewedProposal(tx, saved.id, [])
      return saved
    })

    await this.startTranscription(row.id, input.audioKey)

    return {
      id: row.id,
      personId: row.personId,
      extractionStatus: row.extractionStatus,
      extraction: null,
    }
  }

  // One memo per interaction is the real invariant, and the two unique
  // indexes say so: `clientKey` is only a replay key. A client cannot be
  // relied on to re-send the same one — the phone panel keys its form on
  // personId, so switching tabs and re-recording mints a fresh uuid — and
  // keying the upsert on it alone would take the create branch and collide
  // on `phoneBankingInteractionId` instead of updating the row that is
  // already there. So resolve by the interaction first and fall back to the
  // replay key, which still covers a retry whose first attempt never landed.
  private async upsertKey(
    organizationSlug: string,
    target: CaptureTarget,
    body: RecordConstituentFeedback,
  ): Promise<Prisma.ConstituentFeedbackWhereUniqueInput> {
    const existing = await this.findFirst({
      where: {
        organizationSlug,
        ...(target.doorKnockInteractionId !== null
          ? { doorKnockInteractionId: target.doorKnockInteractionId }
          : { phoneBankingInteractionId: target.phoneBankingInteractionId }),
      },
      select: { id: true },
    })
    return existing !== null
      ? { id: existing.id }
      : {
          organizationSlug_clientKey: {
            organizationSlug,
            clientKey: body.clientKey,
          },
        }
  }

  // Starts a job and records its name for the cron to poll. A start that
  // fails counts as an attempt too and never fails the caller: the row stays
  // pending with no job name, and the cron's next pass tries again while
  // attempts remain.
  async startTranscription(id: string, audioKey: string): Promise<void> {
    let jobName: string | null = null
    try {
      ;({ jobName } = await this.transcribeFile.transcribeFile(audioKey))
    } catch (err) {
      this.logger.error({ err, id }, 'Could not start memo transcription')
    }
    await this.model.updateMany({
      where: { id, transcript: null, transcriptionJobName: null },
      data: {
        transcriptionJobName: jobName,
        transcriptionAttempts: { increment: 1 },
      },
    })
  }

  // Another job for a recording whose last one failed or never answered.
  // Scoped by the old job's name, so a memo re-recorded or confirmed
  // meanwhile is left as it is.
  async restartTranscription(input: {
    id: string
    jobName: string
    audioKey: string
    reason: string
  }): Promise<void> {
    const { count } = await this.model.updateMany({
      where: {
        id: input.id,
        transcriptionJobName: input.jobName,
        transcript: null,
        extractionStatus: ConstituentFeedbackExtractionStatus.pending,
        confirmedAt: null,
      },
      data: { transcriptionJobName: null },
    })
    if (count === 0) {
      this.logger.info(
        { id: input.id, jobName: input.jobName, reason: input.reason },
        'Memo changed while its transcription ran; left as it is',
      )
      return
    }
    this.logger.warn(
      { id: input.id, jobName: input.jobName, reason: input.reason },
      'Memo transcription failed; starting another job',
    )
    await this.startTranscription(input.id, input.audioKey)
  }

  // The job's words, then extraction exactly as a live capture runs it, and
  // the memo is confirmed then and there: nobody who was at the door will
  // see it again, and its words are all synthesis needs, extraction or no
  // extraction. What the model proposed goes to the unreviewed proposal,
  // never onto the memo's issues. The job name scopes the write, so a memo
  // re-recorded or restarted while this one ran is left to its own job, and
  // a memo confirmed while it ran keeps the issues its confirmer gave.
  async completeTranscription(input: {
    id: string
    jobName: string
    transcript: string
  }): Promise<void> {
    const where = {
      id: input.id,
      transcriptionJobName: input.jobName,
      transcript: null,
      extractionStatus: ConstituentFeedbackExtractionStatus.pending,
      confirmedAt: null,
    }
    const transcript = clamp(
      input.transcript.trim(),
      CONSTITUENT_FEEDBACK_TRANSCRIPT_MAX_LENGTH,
    )
    // Silence transcribes to nothing, and another job would hear the same
    // nothing.
    if (!transcript) {
      await this.failTranscription({ ...input, reason: 'empty_transcript' })
      return
    }
    const row = await this.findFirst({
      where,
      select: { effortQuestion: true, actorUserId: true },
    })
    if (row === null) {
      this.logger.info(
        { id: input.id, jobName: input.jobName },
        'Memo changed while its transcription ran; left as it is',
      )
      return
    }

    const extracted = await this.extraction.extract({
      transcript,
      effortQuestion: row.effortQuestion,
      userId: row.actorUserId,
    })
    const confirmed = await this.client.$transaction(async (tx) => {
      const { count } = await tx.constituentFeedback.updateMany({
        where,
        data: {
          transcript,
          ...this.extractionFields(extracted),
          confirmedAt: new Date(),
          confirmation: ConstituentFeedbackConfirmation.automatic,
        },
      })
      if (count === 0) return false
      await replaceUnreviewedProposal(tx, input.id, proposedIssues(extracted))
      return true
    })
    if (confirmed) {
      this.trackMemo(input.id, EVENTS.IssueCapture.MemoAutoConfirmed, {
        reason: 'offline_transcribed',
      })
    }
  }

  // No words, and no more tries: the memo stays unconfirmed with no
  // transcript, which the report shows as a note it could not read. A memo
  // confirmed while its job ran stays as its confirmer left it.
  async failTranscription(input: {
    id: string
    jobName: string | null
    reason: string
  }): Promise<void> {
    const { count } = await this.model.updateMany({
      where: {
        id: input.id,
        transcriptionJobName: input.jobName,
        transcript: null,
        extractionStatus: ConstituentFeedbackExtractionStatus.pending,
        confirmedAt: null,
      },
      data: { extractionStatus: ConstituentFeedbackExtractionStatus.failed },
    })
    if (count === 0) {
      this.logger.info(
        { id: input.id, jobName: input.jobName, reason: input.reason },
        'Memo changed while its transcription ran; left as it is',
      )
      return
    }
    this.logger.warn(
      { id: input.id, jobName: input.jobName, reason: input.reason },
      'Memo transcription failed',
    )
    this.trackMemo(input.id, EVENTS.IssueCapture.MemoTranscriptionFailed, {
      reason: transcriptionFailureReason(input.reason),
    })
  }

  // A live memo whose confirm step never finished: the app closed on the
  // card. Confirmed the way a skip is, so its words reach synthesis, but
  // only if nothing has touched it since the sweep read it, so a confirm
  // that lands first keeps what its confirmer gave.
  async confirmAbandoned(input: {
    id: string
    updatedAt: Date
  }): Promise<void> {
    const confirmed = await this.client.$transaction(async (tx) => {
      const { count } = await tx.constituentFeedback.updateMany({
        where: {
          id: input.id,
          confirmedAt: null,
          updatedAt: input.updatedAt,
        },
        data: {
          confirmedAt: new Date(),
          confirmation: ConstituentFeedbackConfirmation.automatic,
        },
      })
      if (count === 0) return false
      await setAsideProposal(tx, input.id)
      return true
    })
    if (confirmed) {
      this.trackMemo(input.id, EVENTS.IssueCapture.MemoAutoConfirmed, {
        reason: 'abandoned',
      })
    }
  }

  // Attributed to whoever recorded the memo. Runs after the write and is
  // never awaited, so a Segment or lookup failure cannot fail a cron pass
  // that already confirmed or failed the memo. Enums only, never what
  // anyone said.
  private trackMemo(
    id: string,
    event: string,
    properties: Record<string, string>,
  ): void {
    const send = async () => {
      const memo = await this.model.findUniqueOrThrow({
        where: { id },
        select: { actorUserId: true, channel: true, organizationSlug: true },
      })
      await this.analytics.track(memo.actorUserId, event, {
        ...properties,
        channel: ANALYTICS_CHANNEL[memo.channel],
        product: memo.organizationSlug.startsWith('eo-') ? 'serve' : 'win',
      })
    }
    void send().catch((err: Error) =>
      this.logger.warn({ err, id, event }, 'Issue capture event not sent'),
    )
  }

  // The confirmed issues replace whatever the model proposed, in the order
  // sent: one left out is removed, and an empty list confirms a memo that
  // named none. An issue sent with `fromIssueId` keeps that row, so the
  // model's proposal stays beside the answer and a repeated confirm lands on
  // the same rows. A skip confirms the memo with no issues and sets the
  // proposal aside. Either way the issues a memo keeps are ones a person
  // reviewed, which is what later reporting relies on.
  async confirm(input: {
    organizationSlug: string
    id: string
    actorUserId: number
    role: OrganizationRole | undefined
    body: ConfirmConstituentFeedback
  }): Promise<ConstituentFeedbackRecord> {
    const existing = await this.findFirst({
      where: { id: input.id, organizationSlug: input.organizationSlug },
      select: { outreachId: true, channel: true, actorUserId: true },
    })
    if (existing === null) throw new NotFoundException()
    // A confirmation is the word of whoever had the conversation, so a
    // volunteer confirms only their own memo.
    if (
      input.role === OrganizationRole.volunteer &&
      existing.actorUserId !== input.actorUserId
    ) {
      throw new NotFoundException()
    }
    await this.assertVolunteerOnEffort(
      input.role,
      existing.outreachId,
      input.actorUserId,
      existing.channel,
    )

    // A skip only ever confirms a memo nobody has: the drawer's dismiss is a
    // skip, and one racing a "Looks right" can land after it. Claimed with a
    // conditional write so the check cannot race either.
    if (input.body.skipped === true) {
      const skipped = await this.client.$transaction(async (tx) => {
        const { count } = await tx.constituentFeedback.updateMany({
          where: { id: input.id, confirmedAt: null },
          data: {
            confirmedAt: new Date(),
            confirmation: ConstituentFeedbackConfirmation.skipped,
          },
        })
        if (count > 0) await setAsideProposal(tx, input.id)
        return tx.constituentFeedback.findUniqueOrThrow({
          where: { id: input.id },
          include: RECORD_INCLUDE,
        })
      })
      return this.toRecord(skipped)
    }

    const row = await this.client.$transaction(async (tx) => {
      const held = await tx.constituentFeedbackIssue.findMany({
        where: { feedbackId: input.id },
        select: { id: true },
      })
      const heldIds = new Set(held.map((issue) => issue.id))
      const kept = input.body.issues.flatMap((issue) =>
        issue.fromIssueId === undefined ? [] : [issue.fromIssueId],
      )
      if (
        new Set(kept).size !== kept.length ||
        kept.some((id) => !heldIds.has(id))
      ) {
        throw new UnprocessableEntityException(
          'Each fromIssueId must name one of this memo’s issues, once',
        )
      }

      await tx.constituentFeedbackIssue.deleteMany({
        where: { feedbackId: input.id, id: { notIn: kept } },
      })
      // Parked below zero first: positions are unique per memo, and moving a
      // kept issue straight to its new place can land on another one's.
      for (const [i, id] of kept.entries()) {
        await tx.constituentFeedbackIssue.update({
          where: { id },
          data: { position: -1 - i },
        })
      }
      for (const [position, issue] of input.body.issues.entries()) {
        const answer = {
          position,
          issueLabel: issue.issueLabel,
          stance: issue.stance,
          desiredOutcome: issue.desiredOutcome,
        }
        if (issue.fromIssueId === undefined) {
          await tx.constituentFeedbackIssue.create({
            data: { ...answer, feedbackId: input.id },
          })
        } else {
          await tx.constituentFeedbackIssue.update({
            where: { id: issue.fromIssueId },
            data: answer,
          })
        }
      }

      return tx.constituentFeedback.update({
        where: { id: input.id },
        data: {
          confirmedAt: new Date(),
          confirmation: ConstituentFeedbackConfirmation.reviewed,
        },
        include: RECORD_INCLUDE,
      })
    })
    this.codePriorityAnswers(row.outreachId)

    return this.toRecord(row)
  }

  // A resident's text replies to a priority's check, read for issues the
  // way a door or call memo is, so they show on the person's record beside
  // those. The coded yes or no stays PriorityAnswer's; this is the issue,
  // where they stand and what they want.
  //
  // The row has no outreachId on purpose. A text send's report already
  // counts its replies as replies (`textRepliesWhere`), and every effort
  // read keys on that column, so leaving it null keeps the same words from
  // counting twice. Nor is it confirmed: its issues are a model's reading
  // nobody checked, and the abandoned-confirm sweep passes text rows by.
  //
  // Idempotent: a resident whose words have not changed since their row was
  // read costs no model call and writes nothing. Returns how many it wrote.
  async recordPriorityTextReplies(input: {
    organizationSlug: string
    outreachId: number
    question: string | null
    replies: PriorityTextReply[]
  }): Promise<number> {
    if (input.replies.length === 0) return 0
    const existing = await this.findMany({
      where: {
        organizationSlug: input.organizationSlug,
        clientKey: {
          in: input.replies.map((reply) =>
            textReplyClientKey(input.outreachId, reply.personId),
          ),
        },
      },
      select: { clientKey: true, transcript: true, extractionStatus: true },
    })
    const held = new Map(existing.map((row) => [row.clientKey, row]))
    const due = input.replies.flatMap((reply) => {
      const transcript = clamp(
        reply.text.trim(),
        CONSTITUENT_FEEDBACK_TRANSCRIPT_MAX_LENGTH,
      )
      if (transcript === '') return []
      const clientKey = textReplyClientKey(input.outreachId, reply.personId)
      const row = held.get(clientKey)
      const unchanged =
        row !== undefined &&
        row.transcript === transcript &&
        row.extractionStatus !== ConstituentFeedbackExtractionStatus.failed
      return unchanged ? [] : [{ ...reply, transcript, clientKey }]
    })
    if (due.length === 0) return 0

    // The record needs an author and a reply has none on the office's side,
    // so it is the owner's, as a triggered synthesis run is.
    const { ownerId } = await this.client.organization.findUniqueOrThrow({
      where: { slug: input.organizationSlug },
      select: { ownerId: true },
    })

    let written = 0
    for (const reply of due) {
      const extracted = await this.extraction.extract({
        transcript: reply.transcript,
        effortQuestion: input.question,
        userId: ownerId,
        voice: 'own_reply',
      })
      const fields = {
        transcript: reply.transcript,
        occurredAt: reply.repliedAt,
        effortQuestion: input.question,
        confirmedAt: null,
        confirmation: null,
        ...this.extractionFields(extracted),
      }
      await this.client.$transaction(async (tx) => {
        const saved = await tx.constituentFeedback.upsert({
          where: {
            organizationSlug_clientKey: {
              organizationSlug: input.organizationSlug,
              clientKey: reply.clientKey,
            },
          },
          create: {
            organizationSlug: input.organizationSlug,
            clientKey: reply.clientKey,
            personId: reply.personId,
            actorUserId: ownerId,
            channel: ConstituentFeedbackChannel.text,
            captureMethod: ConstituentFeedbackCaptureMethod.typed,
            outreachId: null,
            ...fields,
          },
          update: fields,
        })
        await replaceIssues(tx, saved.id, proposedIssues(extracted))
      })
      written += 1
    }
    return written
  }

  async listForPerson(input: {
    organizationSlug: string
    personId: string
  }): Promise<ConstituentFeedbackRecord[]> {
    const rows = await this.findMany({
      where: {
        organizationSlug: input.organizationSlug,
        personId: input.personId,
      },
      orderBy: { occurredAt: Prisma.SortOrder.desc },
      include: RECORD_INCLUDE,
    })

    return rows.map((row) => this.toRecord(row))
  }

  // A volunteer acts only on an effort they hold an assignment on, the rule
  // the knock and call routes already apply; owners and campaign managers
  // pass. A memo with no effort has nothing to be assigned to, so a
  // volunteer cannot reach it at all.
  private async assertVolunteerOnEffort(
    role: OrganizationRole | undefined,
    outreachId: number | null,
    userId: number,
    channel: ConstituentFeedbackChannel,
  ): Promise<void> {
    if (role !== OrganizationRole.volunteer) return
    if (outreachId === null) {
      throw new NotFoundException(NOT_ASSIGNED_MESSAGE[channel])
    }
    await assertVolunteerAssignedToOutreach(
      this.moduleRef,
      role,
      outreachId,
      userId,
      NOT_ASSIGNED_MESSAGE[channel],
    )
  }

  // Fire-and-forget once the memo is saved: the memo stands whatever the
  // coding does, and the service skips an effort on no priority. Resolved
  // lazily, as the synthesis triggers are.
  private codePriorityAnswers(outreachId: number | null): void {
    if (outreachId === null) return
    try {
      this.moduleRef
        .get(PriorityAnswerCodingService, { strict: false })
        .codeOutreachInBackground(outreachId)
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'Could not start coding answers for a memo',
      )
    }
  }

  private extractionFields(extracted: Extracted): ExtractionFields {
    return extracted === null
      ? {
          extractionStatus: ConstituentFeedbackExtractionStatus.failed,
          ...EMPTY_EXTRACTION,
        }
      : {
          extractionStatus: ConstituentFeedbackExtractionStatus.extracted,
          extractionConfidence: extracted.extraction.confidence,
          extractionModel: extracted.model,
        }
  }

  private toRecord(row: {
    id: string
    personId: string
    occurredAt: Date
    channel: ConstituentFeedbackChannel
    transcript: string | null
    issues: ConstituentFeedbackIssue[]
    extractionStatus: ConstituentFeedbackExtractionStatus
    confirmedAt: Date | null
    outreachId: number | null
    actor: { firstName: string | null; lastName: string | null } | null
    tags: Array<{ tag: ConstituentFeedbackRecord['tags'][number] }>
  }): ConstituentFeedbackRecord {
    const name = [row.actor?.firstName, row.actor?.lastName]
      .filter((part) => part !== null && part !== undefined && part !== '')
      .join(' ')

    return {
      id: row.id,
      personId: row.personId,
      occurredAt: row.occurredAt,
      channel: row.channel,
      transcript: row.transcript,
      issues: row.issues,
      extractionStatus: row.extractionStatus,
      confirmedAt: row.confirmedAt,
      outreachId: row.outreachId,
      actorName: name === '' ? null : name,
      tags: row.tags.map(({ tag }) => tag),
    }
  }

  private async resolveKnock(
    organizationSlug: string,
    knockClientKey: string,
    stopTargetId: number,
  ) {
    const knock = await this.client.contactInteractionDoorKnock.findUnique({
      where: {
        organizationSlug_sourceId: {
          organizationSlug,
          sourceId: knockClientKey,
        },
      },
      select: {
        id: true,
        personId: true,
        outreach: {
          select: {
            id: true,
            doorKnockingTurf: { select: { communityInputQuestion: true } },
          },
        },
      },
    })
    if (knock === null) throw new NotFoundException()

    // Scoped through the turf's own organization so a stop target from
    // another org cannot pull its question into this row.
    const target = await this.client.doorKnockingStopTarget.findFirst({
      where: {
        id: stopTargetId,
        personId: knock.personId,
        stop: { turf: { voterFileFilter: { organizationSlug } } },
      },
      select: {
        stop: {
          select: {
            turf: {
              select: {
                communityInputQuestion: true,
                outreach: { select: { id: true } },
              },
            },
          },
        },
      },
    })
    if (target === null) throw new NotFoundException()

    // The knock's own envelope wins. It was resolved server-side when the
    // knock was written, where `stopTargetId` is only what the client sent
    // with the memo, and a person can sit in two turfs. The question comes
    // from the same envelope so the row never pairs one effort with
    // another's prompt. The stop target's turf covers knocks written before
    // the knock row kept its envelope.
    const outreachId = knock.outreach?.id ?? target.stop.turf.outreach?.id
    if (outreachId === undefined) throw new NotFoundException()
    const effortQuestion =
      knock.outreach === null
        ? target.stop.turf.communityInputQuestion
        : (knock.outreach.doorKnockingTurf?.communityInputQuestion ?? null)

    return {
      personId: knock.personId,
      doorKnockInteractionId: knock.id,
      phoneBankingInteractionId: null,
      effortQuestion,
      outreachId,
    }
  }

  private async resolvePhoneBankCall(
    organizationSlug: string,
    entryId: number,
    personId: string,
  ) {
    const entry = await this.client.phoneBankingListEntry.findFirst({
      where: { id: entryId, list: { organizationSlug } },
      select: {
        phoneBankingListId: true,
        list: {
          select: {
            communityInputQuestion: true,
            outreach: { select: { id: true } },
          },
        },
      },
    })
    if (entry === null) throw new NotFoundException()

    const call = await this.client.contactInteractionPhoneBanking.findUnique({
      where: {
        phoneBankingListId_personId: {
          phoneBankingListId: entry.phoneBankingListId,
          personId,
        },
      },
      select: { id: true, personId: true },
    })
    if (call === null) throw new NotFoundException()

    return {
      personId: call.personId,
      doorKnockInteractionId: null,
      phoneBankingInteractionId: call.id,
      effortQuestion: entry.list.communityInputQuestion,
      // A Win list created with no Campaign row is written without an
      // envelope, so a call can legitimately have no effort to file under.
      outreachId: entry.list.outreach?.id ?? null,
    }
  }
}
