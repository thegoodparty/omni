import { BadGatewayException, Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { addHours, subMinutes } from 'date-fns'
import { ZodError } from 'zod'
import { MimeTypes } from 'http-constants-ts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { AudioTranscodeService } from '@/shared/services/audioTranscode.service'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { ROBOCALL_STAGING_GRACE_MINUTES } from '@/shared/util/robocallHold.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { CallhubMediaService } from '@/vendors/callhub/services/callhubMedia.service'
import { CALLHUB_MEDIA_MIME_TYPES } from '@/vendors/callhub/schemas/callhubMedia.schema'
import {
  CallhubCampaignService,
  CreateVbCampaignResult,
} from '@/vendors/callhub/services/callhubCampaign.service'
import { CallhubPermanentError } from '@/vendors/callhub/services/callhubErrorHandling.service'
import { OutreachType, RobocallSettleState } from '../../generated/prisma'
import { RobocallPhonebookService } from './robocallPhonebook.service'
import { RobocallOrphanedCampaignService } from './robocallOrphanedCampaign.service'
import { OutreachRobocallHoldService } from './outreachRobocallHold.service'

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
    private readonly orphanedCampaigns: RobocallOrphanedCampaignService,
    private readonly hold: OutreachRobocallHoldService,
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
          // caller-ID number gets spam-flagged if it sits idle too long. The
          // lower bound reaches ROBOCALL_STAGING_GRACE_MINUTES BEFORE now, not
          // just now, so a run whose send passed during a deploy/restart/missed
          // tick still stages (and dials a few minutes late) instead of stranding
          // — the stranded sweep only fails runs older than this same
          // `now - grace` boundary, so the two never contend for one draft.
          {
            settleState: RobocallSettleState.authorized,
            outreach: {
              date: {
                gte: subMinutes(now, ROBOCALL_STAGING_GRACE_MINUTES),
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

    // A stale `staging` row we just reclaimed that already carries the permanent
    // marker is a stranded permanent failure whose earlier failSend never
    // committed — fail it now, never re-stage into the same permanent CallHub
    // reject. `draft` was read before the claim, but the marker is only ever set
    // by this permanent path (never cleared while dialing/staging), so it cannot
    // have flipped under us.
    if (draft.permanentSendFailure) {
      await this.failStagingPermanent(outreachId)
      return
    }

    // We own the staging claim. Every failure from here must release it back to
    // authorized so the draft is never stranded — a PAUSED CallHub campaign
    // charges nothing, so reverting after a placed campaign is money-safe. No
    // Stripe is touched in this slice.
    // A robocall row is always campaign-scoped (only social outreach can be
    // org-only, outreach.prisma).
    const campaign = outreach.campaign!
    const campaignName = `Robocall ${campaign.slug} #${outreachId}`
    let created: CreateVbCampaignResult
    try {
      // Upload the (format-sensitive) media BEFORE loading the phonebook: a
      // transcode or upload failure fails fast here, before
      // loadAudienceToPhonebook creates a fresh CallHub phonebook and
      // bulk-imports the audience — real external state we'd otherwise leak on
      // every sweep pass.
      const audio = await this.loadAudio(draft.audioKey)
      // ETAG BIND (legal): the bytes about to reach CallHub MUST be the exact
      // ones that passed compliance. complianceAudioEtag was frozen on the draft
      // at create; refuse to upload anything else — a re-upload to the presigned
      // key after the create gate would otherwise send unapproved audio to real
      // voters. Fail-closed: a null frozen etag (legacy/crafted row) also blocks.
      if (
        !draft.complianceAudioEtag ||
        audio.etag !== draft.complianceAudioEtag
      ) {
        this.logger.error(
          {
            outreachId,
            expectedEtag: draft.complianceAudioEtag,
            actualEtag: audio.etag,
          },
          'CRITICAL robocall audio ETag mismatch at staging; refusing to ' +
            'dial bytes that did not pass compliance',
        )
        throw new BadGatewayException(
          'Robocall audio no longer matches the approved compliance recording',
        )
      }
      const upload = await this.toCallhubAudio(
        audio,
        audioFileName(draft.audioKey),
      )
      const media = await this.media.uploadMedia({
        file: upload.bytes,
        fileName: upload.fileName,
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
      // A PERMANENT CallHub failure will never succeed on retry, so surface it:
      // fail the send (void the hold, email the candidate) instead of reverting
      // to authorized to retry forever. TWO shapes are permanent here:
      //   - a 4xx validation reject (`CallhubPermanentError` — e.g. a rejected
      //     caller ID or media), and
      //   - a `ZodError` from parsing the createVoiceBroadcast response: the
      //     response shape is wrong for real CallHub data, which a retry can
      //     never fix (the completion poll treats its own credits/status ZodError
      //     the same way).
      // BOTH are money-safe to fail here because staging NEVER dials — it only
      // creates a PAUSED campaign — so no calls were placed regardless of which
      // failure it was. The claim is `staging`, which failSend accepts. Transient
      // errors revert + retry as before.
      if (err instanceof CallhubPermanentError || err instanceof ZodError) {
        await this.failStagingPermanent(outreachId)
        return
      }
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
      // nothing, but it must be retired — record its pk_str so the cleanup sweep
      // ABORTs it. Best-effort: a lost record only leaves harmless account
      // clutter and must not fail the (already committed-nothing) stage.
      this.logger.error(
        { outreachId, orphanedCampaignPkStr: created.pk_str },
        'robocall staging committed nothing; orphaned CallHub campaign',
      )
      try {
        await this.orphanedCampaigns.record(
          created.pk_str,
          outreachId,
          'staging_lost_commit',
        )
      } catch (err) {
        this.logger.error(
          { err, outreachId, campaignPkStr: created.pk_str },
          'robocall staging: failed to record orphaned CallHub campaign',
        )
      }
    }
  }

  private async loadAudio(
    audioKey: string,
  ): Promise<{ bytes: Buffer; contentType: string; etag?: string }> {
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
    return {
      bytes: object.bytes,
      contentType: object.contentType,
      etag: object.etag,
    }
  }

  // CallHub's upload accepts only mp3/wav/ogg, but the recorder produces
  // webm/mp4 in the dominant browsers. Upload a CallHub-accepted recording
  // as-is; transcode anything else to mp3 first so a real call can play it.
  private async toCallhubAudio(
    audio: { bytes: Buffer; contentType: string },
    fileName: string,
  ): Promise<{ bytes: Buffer; contentType: string; fileName: string }> {
    const accepted: readonly string[] = CALLHUB_MEDIA_MIME_TYPES
    if (accepted.includes(audio.contentType)) return { ...audio, fileName }
    const bytes = await this.transcode.toMp3(audio.bytes, audio.contentType)
    // CallHub rejects a filename/MIME mismatch, so the transcoded mp3 must
    // carry an .mp3 filename to match its audio/mpeg content-type — a .webm /
    // .m4a name here fails the upload, defeating the transcode.
    return {
      bytes,
      contentType: MimeTypes.AUDIO_MPEG,
      fileName: toMp3FileName(fileName),
    }
  }

  private async revertClaim(outreachId: number): Promise<void> {
    await this.model.updateMany({
      where: { outreachId, settleState: RobocallSettleState.staging },
      data: { settleState: RobocallSettleState.authorized },
    })
  }

  // Persists the permanent-failure marker (best-effort CAS on the `staging` row)
  // then fails the send. The marker is set BEFORE failSend so that if failSend
  // cannot commit (a transient DB error inside it) the row stays `staging`
  // carrying the marker, and the stale-staging sweep reads it and fails the send
  // rather than re-staging into the same permanent CallHub reject. If the marker
  // write itself fails too, the row simply retries next stale pass (a fresh stage
  // re-derives permanence), so it converges. Mirrors `failPermanentSend` in the
  // send slice.
  private async failStagingPermanent(outreachId: number): Promise<void> {
    try {
      await this.model.updateMany({
        where: { outreachId, settleState: RobocallSettleState.staging },
        data: { permanentSendFailure: true },
      })
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'robocall staging: failed to persist the permanent send-failure ' +
          'marker; stale recovery retries it next pass',
      )
    }
    await this.hold.failSend(outreachId, 'staging')
  }
}

// The stored key is `robocall/<campaignId>/<uuid>.<ext>`; the last segment is a
// recognizable filename for the CallHub multipart upload.
const audioFileName = (audioKey: string): string =>
  audioKey.split('/').pop() ?? audioKey

// Swap the extension to .mp3 (keeping the base name) so a transcoded upload's
// filename matches its audio/mpeg content-type.
const toMp3FileName = (fileName: string): string =>
  `${fileName.replace(/\.[^.]+$/, '')}.mp3`
