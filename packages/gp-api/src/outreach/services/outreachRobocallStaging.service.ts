import { BadGatewayException, Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { addHours, subMinutes } from 'date-fns'
import { MimeTypes } from 'http-constants-ts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { AudioTranscodeService } from '@/shared/services/audioTranscode.service'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { CallhubMediaService } from '@/vendors/callhub/services/callhubMedia.service'
import { CALLHUB_MEDIA_MIME_TYPES } from '@/vendors/callhub/schemas/callhubMedia.schema'
import {
  CallhubCampaignService,
  CreateVbCampaignResult,
} from '@/vendors/callhub/services/callhubCampaign.service'
import { OutreachType, RobocallSettleState } from '../../generated/prisma'
import { RobocallPhonebookService } from './robocallPhonebook.service'

// How far ahead of the scheduled send a draft becomes eligible to stage. The
// rented CallHub caller-ID number gets spam-flagged / auto-un-rented if it sits
// idle, so stage CLOSE to the send rather than days early. The window only has
// to comfortably exceed the sweep interval plus the CallHub load time so a draft
// authorized late (just inside the window) still stages before its send; 2h
// gives that margin against a 10-minute sweep while keeping the number's idle
// time small.
const ROBOCALL_STAGING_LEAD_HOURS = 2

// A `staging` row whose updatedAt is older than this is assumed abandoned (a
// process that died after the claim but before commit/revert) and is reclaimed
// by a later sweep. It MUST comfortably exceed the worst-case duration of a
// healthy stageCampaign run (audio download + audience import — which itself
// polls the phonebook load for up to ~2 min — + media upload + campaign create)
// so a merely-SLOW run is never reclaimed and driven into a SECOND CallHub
// campaign. 30 min is many times the observed healthy run and still recovers a
// stranded hold long before its send.
const ROBOCALL_STAGING_STALE_MINUTES = 30

// Every 10 minutes, offset off :00 so the sweep doesn't join the top-of-hour
// herd (and off the existing */10 job). Frequent enough that a draft authorized
// inside the lead window is picked up well before its send. Explicit timeZone
// per docs/scheduled-jobs.md; the minute offset is what matters here.
const ROBOCALL_STAGING_SWEEP_CRON = '7,17,27,37,47,57 * * * *'
const ROBOCALL_STAGING_SWEEP_JOB = 'robocallStagingSweep'

// Stages the CallHub voice-broadcast campaign for an authorized robocall draft:
// loads the audience into a phonebook, uploads the recording, and creates the
// PAUSED (non-dialing) campaign, then persists its pk_str + scheduled window so
// a later slice can dial it. STAGING ONLY — no dial/START, no Stripe. The
// transition is single-owner, mirroring the hold placement: a conditional claim
// (authorized + no campaign yet → staging, or a stale staging row reclaimed)
// elects one stager, the CallHub calls run OUTSIDE any DB transaction, and a
// commit claim (staging → authorized, with the campaign fields) persists only if
// nothing moved underneath.
@Injectable()
export class OutreachRobocallStagingService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  private readonly bucket: string

  constructor(
    private readonly phonebook: RobocallPhonebookService,
    private readonly media: CallhubMediaService,
    private readonly campaigns: CallhubCampaignService,
    private readonly s3: S3Service,
    private readonly transcode: AudioTranscodeService,
  ) {
    super()
    const bucket = process.env.ROBOCALL_AUDIO_BUCKET
    if (!bucket) {
      throw new Error('ROBOCALL_AUDIO_BUCKET is not configured')
    }
    this.bucket = bucket
  }

  // No CronLockService / whole-job lock: staging is idempotent per record behind
  // the atomic claim in stageCampaign, so two replicas racing this sweep both
  // SELECT the same candidates but only ONE wins each draft's claim CAS (the
  // loser reads count 0 and skips) — the CallHub campaign is created exactly
  // once. A job lock would only save a redundant SELECT while adding a
  // CronModule dependency and a dangling-claim failure mode, so it is
  // deliberately omitted. @Cron (not @Interval) so the schedule survives deploys
  // and every replica fires on the same instant.
  //
  // Prod-only (docs/scheduled-jobs.md § Prod-only guard): the sweep creates real
  // external CallHub state against a rate-limited vendor, so it must not fire on
  // dev/preview where the flow is stubbed and every call still counts against
  // the budget. The Pro/paywall gate is inherited, not re-checked here: a draft
  // only reaches `authorized` by passing the Pro-gated authorize endpoint that
  // reserved the hold, so the eligibility filter below is itself the gate — no
  // server-side feature flag exists (the voter-outreach-v2-robocall flag is
  // client-only), matching how the sibling robocall endpoints gate.
  //
  // A draft whose send time passes before it stages (authorized very close to
  // sendAt, or a reclaim that keeps missing the window) drops out of this sweep
  // and is a dial-timing / reconciliation concern owned by the START slice, not
  // handled here.
  @Cron(ROBOCALL_STAGING_SWEEP_CRON, {
    name: ROBOCALL_STAGING_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepRobocallStaging(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return

    const now = new Date()
    const staleCutoff = subMinutes(now, ROBOCALL_STAGING_STALE_MINUTES)
    const candidates = await this.model.findMany({
      where: {
        callhubCampaignPkStr: null,
        outreach: { outreachType: OutreachType.robocall },
        OR: [
          // In-window authorized drafts: stage close to send, since the rented
          // caller-ID number gets spam-flagged if it sits idle too long.
          {
            settleState: RobocallSettleState.authorized,
            outreach: {
              date: {
                gte: now,
                lte: addHours(now, ROBOCALL_STAGING_LEAD_HOURS),
              },
            },
          },
          // Reclaim a draft stranded in `staging` by a crashed run (real hold
          // reserved, otherwise invisible). Older-than-stale only, so a slow
          // healthy run is never re-driven. NO date guard here on purpose: a
          // draft authorized close to its send can go stale only after sendAt
          // has passed, so a date filter would leave it permanently stuck in
          // `staging`. A reclaim whose send has passed fails createVoiceBroadcast
          // and reverts to `authorized`, where a later reconciliation/START
          // slice releases the hold — it must never stay invisible in `staging`.
          {
            settleState: RobocallSettleState.staging,
            updatedAt: { lt: staleCutoff },
          },
        ],
      },
      select: { outreachId: true },
    })

    for (const { outreachId } of candidates) {
      try {
        await this.stageCampaign(outreachId)
      } catch (err) {
        // Per-record isolation: one draft's vendor/storage failure (already
        // reverted to authorized inside stageCampaign) must not abort staging
        // the rest. The next sweep retries it while it is still in-window.
        this.logger.error(
          { err, outreachId },
          'robocall staging failed for a draft; continuing sweep',
        )
      }
    }
  }

  async stageCampaign(outreachId: number): Promise<void> {
    const draft = await this.findFirst({
      where: {
        outreachId,
        outreach: { outreachType: OutreachType.robocall },
      },
      include: { outreach: { include: { campaign: true } } },
    })
    if (!draft) return

    const { outreach } = draft
    const sendAt = outreach.date
    const voterFileFilterId = outreach.voterFileFilterId
    if (!sendAt || voterFileFilterId == null) return

    // CLAIM: elect exactly one stager. Eligible = an unstaged draft that is
    // either `authorized` (the normal path) OR a `staging` row gone stale (a
    // crashed run's stranded claim, reclaimed). A single CAS guards double-
    // staging (a set pk_str fails the null predicate), staging an ineligible
    // draft (any other state fails both branches), AND double-driving a healthy
    // in-flight run (its fresh updatedAt fails the stale predicate). count 0 →
    // not ours. Setting staging bumps @updatedAt, so a concurrent reclaim of the
    // same stale row finds updatedAt no longer < cutoff and loses.
    const staleCutoff = subMinutes(new Date(), ROBOCALL_STAGING_STALE_MINUTES)
    const claim = await this.model.updateMany({
      where: {
        outreachId,
        callhubCampaignPkStr: null,
        OR: [
          { settleState: RobocallSettleState.authorized },
          {
            settleState: RobocallSettleState.staging,
            updatedAt: { lt: staleCutoff },
          },
        ],
      },
      data: { settleState: RobocallSettleState.staging },
    })
    if (claim.count === 0) return

    // We own the staging claim. Every failure from here must release it back to
    // authorized so the draft is never stranded — a PAUSED CallHub campaign
    // charges nothing, so reverting after a placed campaign is money-safe. No
    // Stripe is touched in this slice.
    const campaign = outreach.campaign
    const campaignName = `Robocall ${campaign.slug} #${outreachId}`
    let created: CreateVbCampaignResult
    try {
      // Upload the (format-sensitive) media BEFORE loading the phonebook: a
      // transcode or upload failure fails fast here, before
      // loadAudienceToPhonebook creates a fresh CallHub phonebook and
      // bulk-imports the audience — real external state we'd otherwise leak on
      // every sweep pass.
      const audio = await this.loadAudio(draft.audioKey)
      const upload = await this.toCallhubAudio(audio)
      const media = await this.media.uploadMedia({
        file: upload.bytes,
        fileName: audioFileName(draft.audioKey),
        mimeType: upload.contentType,
        name: campaignName,
      })
      const phonebook = await this.phonebook.loadAudienceToPhonebook(
        campaign,
        voterFileFilterId,
      )
      created = await this.campaigns.createVoiceBroadcast({
        scheduledStart: sendAt,
        name: campaignName,
        phonebookPkStr: phonebook.phonebookPkStr,
        mediaFileId: media.media_file_id,
        callerId: draft.callbackNumber,
      })
    } catch (err) {
      await this.revertClaim(outreachId)
      throw err
    }

    // COMMIT: persist the CallHub handle + the computed dial window and release
    // the claim, only if the draft is still the staging row we own.
    const commit = await this.model.updateMany({
      where: { outreachId, settleState: RobocallSettleState.staging },
      data: {
        settleState: RobocallSettleState.authorized,
        callhubCampaignPkStr: created.pk_str,
        callhubStartingDate: created.startingDate,
        callhubExpirationDate: created.expirationDate,
      },
    })
    if (commit.count === 0) {
      // ORPHAN GUARD: the draft moved out of staging while CallHub was creating
      // (a cancel, or a concurrent stager that somehow advanced it), so the
      // just-created campaign can't be attached. It is PAUSED and charges
      // nothing, but it must be reconciled by hand — log its pk_str. It is NOT
      // deleted here: CallhubCampaignService exposes no delete, and this slice
      // must not build one. This never double-charges or loses the draft.
      this.logger.error(
        { outreachId, orphanedCampaignPkStr: created.pk_str },
        'robocall staging committed nothing; orphaned CallHub campaign',
      )
    }
  }

  private async loadAudio(
    audioKey: string,
  ): Promise<{ bytes: Buffer; contentType: string }> {
    const object = await this.s3.getFileBytesWithContentType(
      this.bucket,
      audioKey,
    )
    if (!object) {
      throw new BadGatewayException('Robocall audio recording is missing')
    }
    // CallHub needs an explicit audio MIME type on the multipart upload; the
    // object's Content-Type was pinned by the presigned upload POST.
    if (!object.contentType) {
      throw new BadGatewayException(
        'Robocall audio recording is missing its content type',
      )
    }
    return { bytes: object.bytes, contentType: object.contentType }
  }

  // CallHub's upload accepts only mp3/wav/ogg, but the recorder produces
  // webm/mp4 in the dominant browsers. Upload a CallHub-accepted recording
  // as-is; transcode anything else to mp3 first so a real call can play it.
  private async toCallhubAudio(audio: {
    bytes: Buffer
    contentType: string
  }): Promise<{ bytes: Buffer; contentType: string }> {
    const accepted: readonly string[] = CALLHUB_MEDIA_MIME_TYPES
    if (accepted.includes(audio.contentType)) return audio
    const bytes = await this.transcode.toMp3(audio.bytes, audio.contentType)
    return { bytes, contentType: MimeTypes.AUDIO_MPEG }
  }

  private async revertClaim(outreachId: number): Promise<void> {
    await this.model.updateMany({
      where: { outreachId, settleState: RobocallSettleState.staging },
      data: { settleState: RobocallSettleState.authorized },
    })
  }
}

// The stored key is `robocall/<campaignId>/<uuid>.<ext>`; the last segment is a
// recognizable filename for the CallHub multipart upload.
const audioFileName = (audioKey: string): string =>
  audioKey.split('/').pop() ?? audioKey
