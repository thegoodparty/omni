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
  CONSTITUENT_FEEDBACK_TRANSCRIPT_MAX_LENGTH,
  ConfirmConstituentFeedback,
  ConstituentFeedbackRecord,
  PendingFeedback,
  PendingFeedbackReference,
  RecordConstituentFeedback,
  RecordConstituentFeedbackResponse,
} from '@goodparty_org/contracts'
import {
  ConstituentFeedbackCaptureMethod,
  ConstituentFeedbackChannel,
  ConstituentFeedbackExtractionStatus,
  ConstituentFeedbackStance,
  IssueTagStatus,
  OrganizationRole,
  Prisma,
} from '@/generated/prisma'
import { assertVolunteerAssignedToOutreach } from '@/doorKnocking/utils/doorKnockingAccess.util'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { APP_ROOT, WEBAPP_API_PATH } from '@/shared/util/appEnvironment.util'
import { TranscribeFileService } from '@/speech/services/transcribeFile.service'
import { SPEECH_BUCKET } from '@/speech/speechBucket'
import { S3Service } from '@/vendors/aws/services/s3.service'
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
const clamp = (value: string | null, max: number): string | null =>
  value === null || value.length <= max ? value : value.slice(0, max)

type ExtractionFields = {
  extractionStatus: ConstituentFeedbackExtractionStatus
  issueLabel: string | null
  stance: ConstituentFeedbackStance | null
  desiredOutcome: string | null
  extractionConfidence: number | null
  extractionModel: string | null
  proposedIssueLabel: string | null
  proposedStance: string | null
  proposedDesiredOutcome: string | null
}

const EMPTY_EXTRACTION = {
  issueLabel: null,
  stance: null,
  desiredOutcome: null,
  extractionConfidence: null,
  extractionModel: null,
  proposedIssueLabel: null,
  proposedStance: null,
  proposedDesiredOutcome: null,
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

// What a person's record reads with each memo. Accepted tags only: a
// proposal is a suggestion nobody has agreed to yet.
const RECORD_INCLUDE = {
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

    const row = await this.model.upsert({
      where: await this.upsertKey(input.organizationSlug, target, input.body),
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
      // A re-record REPLACES the triple with a fresh model proposal, so any
      // confirmation the old one earned is void. Leaving `confirmedAt` set
      // would hand reporting a model guess wearing a human's signature, which
      // is the one thing the column exists to prevent.
      update: {
        transcript,
        captureMethod: input.body.captureMethod,
        // A live re-record replaces an offline one outright.
        audioKey: null,
        transcriptionJobName: null,
        // Re-read, not left at the first recording's value: the effort's
        // question can be edited between the two, and `extract()` above always
        // runs against the current one. Keeping the old copy here would leave
        // the row claiming a prompt the extraction never saw.
        effortQuestion: target.effortQuestion,
        outreachId: target.outreachId,
        confirmedAt: null,
        ...this.extractionFields(extracted),
      },
    })

    return {
      id: row.id,
      personId: row.personId,
      extractionStatus: row.extractionStatus,
      extraction:
        extracted === null
          ? null
          : {
              issueLabel: row.issueLabel,
              stance: row.stance,
              desiredOutcome: row.desiredOutcome,
            },
    }
  }

  // The offline path. The phone recorded with no signal and has since put
  // the audio at `audioKey`, so there are no words yet: the row is saved
  // pending, a Transcribe job starts, and the pending-transcription cron
  // writes the transcript and runs extraction when the job finishes. Nobody
  // is at the door any more, so the triple waits in the "Notes to review"
  // list instead of a confirm card.
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
      ...EMPTY_EXTRACTION,
      extractionStatus: ConstituentFeedbackExtractionStatus.pending,
    }

    const row = await this.model.upsert({
      where: await this.upsertKey(input.organizationSlug, target, input.body),
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
      // Same rule as a live re-record: whatever was confirmed before is void.
      update: pending,
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

  // Starts the job and records its name for the cron to poll. A failure to
  // start never fails the caller: the row stays pending with no job name,
  // and the cron's next pass starts it.
  async startTranscription(id: string, audioKey: string): Promise<void> {
    try {
      const { jobName } = await this.transcribeFile.transcribeFile(audioKey)
      await this.model.updateMany({
        where: { id, transcript: null, transcriptionJobName: null },
        data: { transcriptionJobName: jobName },
      })
    } catch (err) {
      this.logger.error({ err, id }, 'Could not start memo transcription')
    }
  }

  // The job's words, then extraction exactly as a live capture runs it. The
  // job name scopes both writes, so a memo re-recorded or retried while this
  // one ran is left to its own job. `confirmedAt` stays null: the person
  // who was there confirms it from the review list.
  async completeTranscription(input: {
    id: string
    jobName: string
    transcript: string
  }): Promise<void> {
    const where = {
      id: input.id,
      transcriptionJobName: input.jobName,
      transcript: null,
    }
    const transcript = clamp(
      input.transcript.trim(),
      CONSTITUENT_FEEDBACK_TRANSCRIPT_MAX_LENGTH,
    )
    // Silence transcribes to nothing, and nothing has no issue in it.
    if (!transcript) {
      await this.failTranscription({ ...input, reason: 'empty_transcript' })
      return
    }
    const row = await this.findFirst({
      where,
      select: { effortQuestion: true, actorUserId: true },
    })
    if (row === null) return

    const extracted = await this.extraction.extract({
      transcript,
      effortQuestion: row.effortQuestion,
      userId: row.actorUserId,
    })
    await this.model.updateMany({
      where,
      data: { transcript, ...this.extractionFields(extracted) },
    })
  }

  // The recording survives, so the review list offers to try again.
  async failTranscription(input: {
    id: string
    jobName: string | null
    reason: string
  }): Promise<void> {
    this.logger.warn(
      { id: input.id, jobName: input.jobName, reason: input.reason },
      'Memo transcription failed',
    )
    await this.model.updateMany({
      where: {
        id: input.id,
        transcriptionJobName: input.jobName,
        transcript: null,
        extractionStatus: ConstituentFeedbackExtractionStatus.pending,
      },
      data: { extractionStatus: ConstituentFeedbackExtractionStatus.failed },
    })
  }

  // An effort's unconfirmed memos, newest first: the "Notes to review" list.
  // A volunteer sees the ones they recorded, which they can only have done on
  // an effort they were assigned; an owner or manager sees everyone's.
  async listPending(input: {
    organizationSlug: string
    outreachId: number
    actorUserId: number
    role: OrganizationRole | undefined
  }): Promise<PendingFeedback[]> {
    const rows = await this.findMany({
      where: {
        organizationSlug: input.organizationSlug,
        outreachId: input.outreachId,
        confirmedAt: null,
        ...(input.role === OrganizationRole.volunteer
          ? { actorUserId: input.actorUserId }
          : {}),
      },
      orderBy: { occurredAt: Prisma.SortOrder.desc },
      include: {
        ...RECORD_INCLUDE,
        doorKnockInteraction: { select: { sourceId: true } },
        phoneBankingInteraction: { select: { phoneBankingListId: true } },
      },
    })
    const references = await this.referencesFor(input.outreachId, rows)
    return rows.map((row) => ({
      ...this.toRecord(row),
      clientKey: row.clientKey,
      reference: references.get(row.id) ?? null,
    }))
  }

  // What a capture would post for each memo. Neither row keeps the stop
  // target or the list entry it was recorded against, so they are found
  // again: the person's stop target on this effort's turf, and their entry
  // on the call's list. Two queries for the whole list, not one per memo.
  private async referencesFor(
    outreachId: number,
    rows: Array<{
      id: string
      personId: string
      doorKnockInteraction: { sourceId: string | null } | null
      phoneBankingInteraction: { phoneBankingListId: number | null } | null
    }>,
  ): Promise<Map<string, PendingFeedbackReference>> {
    const knockPersonIds = rows
      .filter((row) => row.doorKnockInteraction !== null)
      .map((row) => row.personId)
    const listIds = [
      ...new Set(
        rows.flatMap((row) => {
          const listId = row.phoneBankingInteraction?.phoneBankingListId
          return listId === null || listId === undefined ? [] : [listId]
        }),
      ),
    ]
    const [stopTargets, entryPeople] = await Promise.all([
      knockPersonIds.length === 0
        ? []
        : this.client.doorKnockingStopTarget.findMany({
            where: {
              personId: { in: knockPersonIds },
              stop: { turf: { outreach: { id: outreachId } } },
            },
            select: { id: true, personId: true },
          }),
      listIds.length === 0
        ? []
        : this.client.phoneBankingListEntryPerson.findMany({
            where: {
              personId: { in: rows.map((row) => row.personId) },
              entry: { phoneBankingListId: { in: listIds } },
            },
            select: {
              personId: true,
              phoneBankingListEntryId: true,
              entry: { select: { phoneBankingListId: true } },
            },
          }),
    ])
    const stopTargetByPerson = new Map(
      stopTargets.map((target) => [target.personId, target.id]),
    )
    const entryByListAndPerson = new Map(
      entryPeople.map((person) => [
        `${person.entry.phoneBankingListId}:${person.personId}`,
        person.phoneBankingListEntryId,
      ]),
    )

    const references = new Map<string, PendingFeedbackReference>()
    for (const row of rows) {
      const knockClientKey = row.doorKnockInteraction?.sourceId
      const stopTargetId = stopTargetByPerson.get(row.personId)
      if (knockClientKey && stopTargetId !== undefined) {
        references.set(row.id, {
          channel: ConstituentFeedbackChannel.door_knock,
          knockClientKey,
          stopTargetId,
        })
      }
      const listId = row.phoneBankingInteraction?.phoneBankingListId
      const entryId = entryByListAndPerson.get(`${listId}:${row.personId}`)
      if (listId !== undefined && listId !== null && entryId !== undefined) {
        references.set(row.id, {
          channel: ConstituentFeedbackChannel.phone_bank,
          entryId,
          personId: row.personId,
        })
      }
    }
    return references
  }

  // The review list's "Try again", which is also the recovery for a memo
  // whose transcription or extraction failed online. A recording with no
  // words yet is transcribed again; words with no triple are extracted
  // again. A volunteer retries only their own memo, on an effort they are
  // still assigned to.
  async retry(input: {
    organizationSlug: string
    id: string
    actorUserId: number
    role: OrganizationRole | undefined
  }): Promise<ConstituentFeedbackRecord> {
    const row = await this.findFirst({
      where: {
        id: input.id,
        organizationSlug: input.organizationSlug,
        confirmedAt: null,
      },
      select: {
        outreachId: true,
        channel: true,
        actorUserId: true,
        transcript: true,
        audioKey: true,
        effortQuestion: true,
      },
    })
    if (row === null) throw new NotFoundException()
    if (
      input.role === OrganizationRole.volunteer &&
      row.actorUserId !== input.actorUserId
    ) {
      throw new NotFoundException()
    }
    await this.assertVolunteerOnEffort(
      input.role,
      row.outreachId,
      input.actorUserId,
      row.channel,
    )

    if (row.transcript !== null) {
      const extracted = await this.extraction.extract({
        transcript: row.transcript,
        effortQuestion: row.effortQuestion,
        userId: input.actorUserId,
      })
      await this.model.update({
        where: { id: input.id },
        data: this.extractionFields(extracted),
      })
    } else if (row.audioKey !== null) {
      await this.model.update({
        where: { id: input.id },
        data: {
          extractionStatus: ConstituentFeedbackExtractionStatus.pending,
          transcriptionJobName: null,
        },
      })
      await this.startTranscription(input.id, row.audioKey)
    } else {
      throw new UnprocessableEntityException('This memo has nothing to retry')
    }

    return this.toRecord(
      await this.model.findUniqueOrThrow({
        where: { id: input.id },
        include: RECORD_INCLUDE,
      }),
    )
  }

  // The confirmed triple replaces whatever the model proposed. `confirmedAt`
  // is what later reporting reads to tell a first-hand answer apart from an
  // unreviewed guess, so it is only ever set here.
  async confirm(input: {
    organizationSlug: string
    id: string
    actorUserId: number
    role: OrganizationRole | undefined
    body: ConfirmConstituentFeedback
  }): Promise<ConstituentFeedbackRecord> {
    const existing = await this.findFirst({
      where: { id: input.id, organizationSlug: input.organizationSlug },
      select: { outreachId: true, channel: true },
    })
    if (existing === null) throw new NotFoundException()
    await this.assertVolunteerOnEffort(
      input.role,
      existing.outreachId,
      input.actorUserId,
      existing.channel,
    )

    const row = await this.model.update({
      where: { id: input.id },
      data: {
        issueLabel: input.body.issueLabel,
        stance: input.body.stance,
        desiredOutcome: input.body.desiredOutcome,
        confirmedAt: new Date(),
      },
      include: RECORD_INCLUDE,
    })

    return this.toRecord(row)
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

  private extractionFields(
    extracted: { extraction: RawExtraction; model: string } | null,
  ): ExtractionFields {
    return extracted === null
      ? {
          extractionStatus: ConstituentFeedbackExtractionStatus.failed,
          ...EMPTY_EXTRACTION,
        }
      : {
          extractionStatus: ConstituentFeedbackExtractionStatus.extracted,
          issueLabel: clamp(
            extracted.extraction.issueLabel,
            CONSTITUENT_FEEDBACK_ISSUE_LABEL_MAX_LENGTH,
          ),
          stance: toStance(extracted.extraction.stance),
          desiredOutcome: clamp(
            extracted.extraction.desiredOutcome,
            CONSTITUENT_FEEDBACK_DESIRED_OUTCOME_MAX_LENGTH,
          ),
          extractionConfidence: extracted.extraction.confidence,
          extractionModel: extracted.model,
          proposedIssueLabel: extracted.extraction.issueLabel,
          proposedStance: extracted.extraction.stance,
          proposedDesiredOutcome: extracted.extraction.desiredOutcome,
        }
  }

  private toRecord(row: {
    id: string
    personId: string
    occurredAt: Date
    channel: ConstituentFeedbackChannel
    transcript: string | null
    issueLabel: string | null
    stance: ConstituentFeedbackStance | null
    desiredOutcome: string | null
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
      issueLabel: row.issueLabel,
      stance: row.stance,
      desiredOutcome: row.desiredOutcome,
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
