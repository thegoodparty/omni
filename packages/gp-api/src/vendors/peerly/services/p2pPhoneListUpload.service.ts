import {
  BadGatewayException,
  BadRequestException,
  forwardRef,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { subMinutes } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { Campaign, Organization } from '../../../generated/prisma'
import { CampaignTcrComplianceService } from '../../../campaigns/tcrCompliance/services/campaignTcrCompliance.service'
import { MAX_RESOLVED_ID_SET_SIZE } from '@/contactInteraction/services/activityConditionResolution.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import {
  ContactsFilterResolutionInput,
  ContactsService,
} from '@/contacts/services/contacts.service'
import {
  MAX_INTERACTIVE_RESOLUTION_MS,
  PhoneAudiencePerson,
  resolveFilterAudience,
} from '@/contacts/utils/audienceResolution.util'
import { csvEscape } from '@/shared/util/csv.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { MessageGroup, QueueType } from '@/queue/queue.types'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { OrganizationsService } from '../../../organizations/services/organizations.service'
import {
  P2pPhoneListRequestSchema,
  p2pPhoneListRequestSchema,
} from '../schemas/p2pPhoneListRequest.schema'
import { OutreachP2pSmsCaptureService } from '@/outreach/services/outreachP2pSmsCapture.service'
import { PeerlyPhoneListCaptureService } from './peerlyPhoneListCapture.service'
import { PeerlyPhoneListService } from './peerlyPhoneList.service'
import { PhoneListState } from '../peerly.types'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { isWinSmsHoldBillingEnabled } from '@/shared/util/winSmsHold.util'

// Mirrors outreachMaterialization.service.ts's paging shape. Not shared as an
// export — each contacts-pipeline consumer keeps its own copy (see that
// file's SEGMENT_PAGE_SIZE for the sibling constant).
const SEGMENT_PAGE_SIZE = 1000
const MAX_PHONE_LIST_RECIPIENTS = 100_000

const CSV_HEADER_ROW = 'first_name,last_name,lead_phone,state,city,zip'

type PhoneListRecipient = { personId: string; phone: string }

// The validated request minus the list name — what both resolveFilterInput
// call sites (the live HTTP body, and a snapshot re-parsed off the build row)
// actually have in hand. Derived from the same schema both use, so a
// snapshot round-trip can never drift from the live request's shape.
type P2pPhoneListFilterInput = Omit<
  z.infer<typeof p2pPhoneListRequestSchema>,
  'name'
>

// Voter Outreach 2.0's async build (S3b) ships behind the SAME kill switch as
// Win p2p SMS hold-billing: the async build was the whole reason hold-billing
// exists (pay-before-ready needs a build that can still be running when
// checkout happens), so the two ship and roll back together as one flag.
const isAsyncBuildEnabled = (): boolean => isWinSmsHoldBillingEnabled()

// A `building` row whose updatedAt is older than this is assumed abandoned
// (the handler crashed, was OOM-killed, or lost its SQS message before
// finishing) and is reclaimed by the sweep below. Comfortably exceeds a
// healthy-but-slow run: filter resolution over a 100k-recipient audience
// plus a ~100MB Peerly upload, against a 60s Peerly upload timeout
// (peerlyBaseConfig's PEERLY_UPLOAD_TIMEOUT_MS) — this has no request
// deadline (see buildPhoneList's isInteractive branch), so it can
// legitimately run for several minutes.
const P2P_PHONE_LIST_BUILD_STALE_MINUTES = 20
// How many times the reaper will re-queue a stuck build before giving up and
// marking it permanently failed. Bounds a build that fails the same way on
// every retry (e.g. a persistently broken filter) rather than re-queuing it
// forever.
const P2P_PHONE_LIST_BUILD_MAX_ATTEMPTS = 3
// Every 15 minutes, offset off the top of the hour. grep -rn '@Cron(' before
// changing this — see docs/scheduled-jobs.md.
const P2P_PHONE_LIST_BUILD_SWEEP_CRON = '14,29,44,59 * * * *'
const P2P_PHONE_LIST_BUILD_SWEEP_JOB = 'p2pPhoneListBuildStaleSweep'
// Every 15 minutes, on digits the sibling sweep above (4/9) and the */5 and
// top-of-hour herds don't use. The robocall 6-lane sweep family saturates the
// minute space in this one process, so no slot is collision-free; this one at
// least shares no instant with the sibling p2p sweep. grep -rn '@Cron(' before
// changing — see docs/scheduled-jobs.md.
const P2P_PHONE_LIST_FINISH_SWEEP_CRON = '8,23,38,53 * * * *'
const P2P_PHONE_LIST_FINISH_SWEEP_JOB = 'p2pPhoneListFinishSweep'
// A `processing` row untouched for this long is assumed stranded: the
// candidate's browser poll — which would otherwise stamp it `ready` — has
// stopped (the tab closed). Comfortably exceeds the browser poll interval so
// the finisher never races a live poll: a still-loading list under active
// poll keeps a fresh updatedAt (isLeadsLoadedStable writes each unstable
// read) and so stays out of the sweep until the browser gives up.
const P2P_PHONE_LIST_FINISH_STALE_MINUTES = 10
// Caps the Peerly reads one sweep issues (up to 2 per row), so a backlog of
// stranded rows can't make a single pass hammer the rate-limited vendor or
// overrun the cron cadence; the remainder are finished on the next pass,
// oldest first.
const P2P_PHONE_LIST_FINISH_BATCH_SIZE = 100
// Deploys the finisher runs on. dev as well as prod — unlike the robocall
// sweeps it moves no money and sends nothing, only advancing a build to
// `ready`, and the project's sendless dev validation needs it running on dev,
// which a strict prod-only guard would silently prevent. NOT an exclusion of
// `preview`: OTEL_SERVICE_ENVIRONMENT is `preview` on every PR-preview stack
// at once (~25), so an ungated vendor sweep would fire ~25 identical passes
// against one shared Peerly budget (docs/scheduled-jobs.md § Not prod-only).
// Fail-closed: an absent/unexpected value (local, vitest) isn't in the set, so
// it skips.
const P2P_PHONE_LIST_FINISH_DEPLOY_ENVIRONMENTS = new Set(['dev', 'prod'])

// Peerly needs state, city, and zip for geo-targeting; null fields
// produce blank CSV cells it counts as malformed leads. The people
// response is a cast, not a parse, so address itself can be absent.
const hasGeoTargetableAddress = (person: PhoneAudiencePerson) =>
  Boolean(
    person.address &&
    person.address.state &&
    person.address.city &&
    person.address.zip,
  )

@Injectable()
export class P2pPhoneListUploadService {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly organizationsService: OrganizationsService,
    private readonly peerlyPhoneListService: PeerlyPhoneListService,
    private readonly peerlyPhoneListCapture: PeerlyPhoneListCaptureService,
    private readonly tcrComplianceService: CampaignTcrComplianceService,
    private readonly voterFileFilterService: VoterFileFilterService,
    private readonly contactInteractionTextService: ContactInteractionTextService,
    private readonly queueProducer: QueueProducerService,
    // forwardRef: OutreachModule and PeerlyModule import each other, so the
    // capture provider is resolved through that cycle.
    @Inject(forwardRef(() => OutreachP2pSmsCaptureService))
    private readonly p2pSmsCapture: OutreachP2pSmsCaptureService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(P2pPhoneListUploadService.name)
  }

  async uploadPhoneList(
    campaign: Campaign,
    request: P2pPhoneListRequestSchema,
  ): Promise<{ token: string | null; listName: string; buildId: string }> {
    const { name: listName, ...filterInput } = request

    if (isAsyncBuildEnabled()) {
      // Nothing is validated beyond the request's own shape (already done by
      // the controller's ZodValidationPipe) before the row exists — TCR
      // compliance, organization, filter resolution, opt-out scrub, CSV
      // generation, and the Peerly upload all move onto the queue, so a
      // setup problem (no TCR identity, a deleted filter) surfaces as a
      // `failed` build status rather than a synchronous 400. See
      // handleQueuedBuild.
      const build = await this.peerlyPhoneListCapture.createQueuedBuild({
        organizationSlug: campaign.organizationSlug,
        campaignId: campaign.id,
        voterFileFilterId: filterInput.voterFileFilterId ?? null,
        requestSnapshot: { ...request },
      })

      // AFTER the row commits (queue outbox rule: never enqueue before the
      // thing the handler will look up exists), and `throwOnError` because a
      // producer failure swallowed here would accept a request nothing will
      // ever build (queue/AGENTS.md "Failure modes").
      await this.enqueueBuild(build.id, 0)
      this.logger.debug(
        `P2P phone list build ${build.id} enqueued for campaign ${campaign.id}`,
      )
      return { token: null, listName, buildId: build.id }
    }

    // --- Synchronous (switch off) path — unchanged S2 behavior. ---
    const tcrCompliance = await this.tcrComplianceService.fetchByCampaignId(
      campaign.id,
    )
    if (!tcrCompliance || !tcrCompliance.peerlyIdentityId) {
      throw new BadRequestException(
        'TCR compliance record does not have a Peerly identity ID',
      )
    }

    const organization = await this.organizationsService.findFirst({
      where: { slug: campaign.organizationSlug },
    })
    if (!organization) {
      throw new BadRequestException('Organization not found for campaign')
    }

    // Texting is a Pro feature — PII exposure stays bounded by the Pro gate
    // (isProAccess, enforced inside findContactsForFilter below).
    // Product decision (Tomer, 2026-07-18): ENG-10741.
    const resolvedFilterInput = await this.resolveFilterInput(
      filterInput,
      campaign.organizationSlug,
    )
    if (resolvedFilterInput === null) {
      throw new BadRequestException('Voter file filter not found')
    }

    const excludePersonIds = await this.resolveOptOutScrub(
      campaign.organizationSlug,
    )

    // Created BEFORE the build so a build-status poller has a row to find
    // from the moment the request is accepted (`queued`, the schema
    // default) — everything above this line is request validation (bad
    // input 400s before any row exists); everything below is "the build",
    // and any throw in it must park this same row `failed` rather than
    // leave it orphaned.
    const build = await this.peerlyPhoneListCapture.createQueuedBuild({
      organizationSlug: campaign.organizationSlug,
      campaignId: campaign.id,
      voterFileFilterId: filterInput.voterFileFilterId ?? null,
      requestSnapshot: { ...request },
    })

    const token = await this.runBuild({
      buildId: build.id,
      campaignId: campaign.id,
      organization,
      peerlyIdentityId: tcrCompliance.peerlyIdentityId,
      listName,
      resolvedFilterInput,
      excludePersonIds,
      isInteractive: true,
    })

    return { token, listName, buildId: build.id }
  }

  // Queue handler for QueueType.P2P_PHONE_LIST_BUILD (dispatched from
  // queueConsumer.service.ts — no business logic there, it only dispatches).
  // Returns true to ack. Throws to let SQS redeliver; the claim CAS below
  // (queued-only) makes a redelivery or a reaper-driven retry safe either
  // way — see queue/AGENTS.md "Failure modes".
  async handleQueuedBuild(buildId: string): Promise<boolean> {
    const claimed = await this.peerlyPhoneListCapture.claimForBuild(buildId)
    if (!claimed) {
      // A concurrent delivery already owns this build, or it has already
      // advanced past `queued` (processing/ready/failed) — idempotent no-op.
      this.logger.info(
        { buildId },
        'p2pPhoneListBuild: claim missed (already owned or advanced); acking',
      )
      return true
    }

    const build = await this.peerlyPhoneListCapture.findFirst({
      where: { id: buildId },
    })
    if (!build) {
      // Can't happen in the normal flow (the claim above just matched this
      // row by id) — but a redelivery racing a hard-delete elsewhere must
      // not crash the consumer.
      this.logger.error(
        { buildId },
        'p2pPhoneListBuild: claimed row vanished; acking',
      )
      return true
    }

    const snapshot = p2pPhoneListRequestSchema.safeParse(build.requestSnapshot)
    if (!snapshot.success) {
      this.logger.error(
        { buildId, error: snapshot.error },
        'p2pPhoneListBuild: stored request snapshot missing or invalid',
      )
      await this.markBuildFailed(
        buildId,
        new BadRequestException('Missing or invalid build request'),
      )
      return true
    }
    const { name: listName, ...filterInput } = snapshot.data

    const tcrCompliance = await this.tcrComplianceService.fetchByCampaignId(
      build.campaignId,
    )
    if (!tcrCompliance?.peerlyIdentityId) {
      await this.markBuildFailed(
        buildId,
        new BadRequestException(
          'TCR compliance record does not have a Peerly identity ID',
        ),
      )
      return true
    }

    const organization = await this.organizationsService.findFirst({
      where: { slug: build.organizationSlug },
    })
    if (!organization) {
      await this.markBuildFailed(
        buildId,
        new BadRequestException('Organization not found for campaign'),
      )
      return true
    }

    const resolvedFilterInput = await this.resolveFilterInput(
      filterInput,
      build.organizationSlug,
    )
    if (resolvedFilterInput === null) {
      await this.markBuildFailed(
        buildId,
        new BadRequestException('Voter file filter not found'),
      )
      return true
    }

    const excludePersonIds = await this.resolveOptOutScrub(
      build.organizationSlug,
    )

    try {
      await this.runBuild({
        buildId,
        campaignId: build.campaignId,
        organization,
        peerlyIdentityId: tcrCompliance.peerlyIdentityId,
        listName,
        resolvedFilterInput,
        excludePersonIds,
        isInteractive: false,
        existingToken: build.token ?? undefined,
      })
      return true
    } catch (error) {
      if (error instanceof HttpException) {
        // runBuild already called markBuildFailed before throwing — a
        // permanent, client-input-shaped failure. Ack; retrying can't help.
        return true
      }
      // Transient (people-db, S3, a Peerly 5xx/network, or anything
      // unclassified): rethrow so SQS redelivers. The claim is single-owner
      // and queued-only, so the actual retry is driven by the stale-building
      // reaper resetting this row back to `queued`, not by SQS's own
      // redelivery of this exact message landing on a `building` row.
      throw error
    }
  }

  // Stale-building reaper: a row claimed (queued -> building) by some
  // handler invocation that never finished gets re-queued, or parked
  // `failed` once it has used up its retry budget. Per-record CAS
  // (reclaimStaleBuilding/failStaleBuilding), idempotent across replicas and
  // across overlapping sweeps — mirrors
  // OutreachRobocallStagingService.sweepRobocallStaging's reasoning for
  // omitting a whole-job CronLockService: two replicas can both SELECT the
  // same stale candidate, but only one's CAS matches (the other's `updatedAt
  // < staleCutoff` predicate loses once the winner bumps it), so a build is
  // never re-queued twice from one sweep.
  @Cron(P2P_PHONE_LIST_BUILD_SWEEP_CRON, {
    name: P2P_PHONE_LIST_BUILD_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepStaleBuilding(): Promise<void> {
    const staleCutoff = subMinutes(
      new Date(),
      P2P_PHONE_LIST_BUILD_STALE_MINUTES,
    )
    const candidates =
      await this.peerlyPhoneListCapture.findStaleBuilding(staleCutoff)

    for (const { id: buildId } of candidates) {
      try {
        await this.reclaimStaleBuild(buildId, staleCutoff)
      } catch (err) {
        // Per-record isolation: one build's failure must not abort
        // reclaiming the rest. The next sweep retries it.
        this.logger.error(
          { err, buildId },
          'p2pPhoneListBuild stale-building reclaim failed; continuing sweep',
        )
      }
    }
  }

  private async reclaimStaleBuild(
    buildId: string,
    staleCutoff: Date,
  ): Promise<void> {
    const row = await this.peerlyPhoneListCapture.findFirst({
      where: { id: buildId },
      select: { buildAttempts: true },
    })
    if (!row) return

    if (row.buildAttempts >= P2P_PHONE_LIST_BUILD_MAX_ATTEMPTS) {
      await this.peerlyPhoneListCapture.failStaleBuilding(
        buildId,
        staleCutoff,
        'Phone list build exceeded its retry limit',
      )
      return
    }

    const reclaimed = await this.peerlyPhoneListCapture.reclaimStaleBuilding(
      buildId,
      staleCutoff,
    )
    // count 0: another replica already reclaimed/failed it, or it advanced
    // (a healthy run finished between the SELECT and here) — not ours.
    if (!reclaimed) return

    try {
      await this.enqueueBuild(buildId, row.buildAttempts)
    } catch (err) {
      // Undo the reclaim so the row doesn't strand at `queued` with nothing
      // ever claiming it — the reaper only looks at `building` rows, so a
      // `queued` row with a dead enqueue would otherwise sit forever.
      await this.peerlyPhoneListCapture.revertReclaimedBuilding(buildId)
      throw err
    }
  }

  // Server-side build finisher. Today a `processing` build only reaches
  // `ready` (stable leads_loaded + the numeric Peerly list id stamped) when
  // the candidate's browser polls the status route (p2p.controller.ts
  // resolveListStatus). If the tab closes mid-build nothing finishes it and
  // the list strands at `processing` forever. This sweep does the same Peerly
  // read + stamp headless.
  //
  // No CronLockService, mirroring sweepStaleBuilding and
  // OutreachRobocallStagingService.sweepRobocallStaging: the stamp is a
  // single-owner CAS (stampPeerlyListId guards on peerlyListId IS NULL), so
  // two replicas both reading ACTIVE stamp exactly once, and a concurrent
  // browser poll can't double-stamp either. Gated to the dev+prod deploys
  // (not every preview stack) because it reads a rate-limited vendor (Peerly);
  // it runs on dev as well as prod since it moves no money and sends nothing,
  // and sendless dev validation depends on it. process.env is read live so a
  // test can stub the gate.
  //
  // Selection is bounded by a stale-age floor and a batch cap (see the two
  // constants above) so the vendor reads stay bounded per pass. A row whose
  // Peerly list never cleanly resolves (never ACTIVE, or ACTIVE with no
  // list_id) is re-read each pass and left `processing` — the same end state
  // it already has today, and a terminal-failure path for it is intentionally
  // out of this slice's scope (which is producing `ready`), mirroring how the
  // stale-building reaper and this finisher stay separate concerns.
  @Cron(P2P_PHONE_LIST_FINISH_SWEEP_CRON, {
    name: P2P_PHONE_LIST_FINISH_SWEEP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepUnfinishedBuilds(): Promise<void> {
    if (
      !P2P_PHONE_LIST_FINISH_DEPLOY_ENVIRONMENTS.has(
        process.env.OTEL_SERVICE_ENVIRONMENT ?? '',
      )
    ) {
      return
    }

    const staleCutoff = subMinutes(
      new Date(),
      P2P_PHONE_LIST_FINISH_STALE_MINUTES,
    )
    const candidates =
      await this.peerlyPhoneListCapture.findUnfinishedProcessing({
        staleCutoff,
        take: P2P_PHONE_LIST_FINISH_BATCH_SIZE,
      })

    for (const { id: buildId, token } of candidates) {
      if (!token) continue
      try {
        await this.finishBuild(buildId, token)
      } catch (err) {
        // Per-record isolation: one build's Peerly failure must not abort
        // finishing the rest. The next sweep retries it.
        this.logger.error(
          { err, buildId },
          'p2pPhoneListBuild finish failed for a build; continuing sweep',
        )
      }
    }
  }

  // Headless counterpart to p2p.controller.ts resolveListStatus: poll Peerly,
  // and once the list is ACTIVE with a stable leads_loaded, stamp the numeric
  // list id + `ready`. A not-yet-ACTIVE or still-loading list is left
  // `processing` for a later pass (isLeadsLoadedStable records the reading so
  // the next pass can compare the same value twice). Reuses the same
  // capture-service helpers the browser route does rather than duplicating the
  // stability/stamp logic.
  private async finishBuild(buildId: string, token: string): Promise<void> {
    const statusResponse =
      await this.peerlyPhoneListService.checkPhoneListStatus(token)
    if (!statusResponse) return
    if (statusResponse.Data.list_state !== PhoneListState.ACTIVE) return

    const listId = statusResponse.Data.list_id
    if (!listId) {
      // ACTIVE with no list_id is the one shape the browser route 502s on;
      // here no caller is waiting, so log and leave it for the next pass.
      this.logger.warn(
        { buildId, token },
        'Peerly reported ACTIVE with no list_id; leaving build processing',
      )
      return
    }

    const details =
      await this.peerlyPhoneListService.getPhoneListDetails(listId)
    const stable = await this.peerlyPhoneListCapture.isLeadsLoadedStable({
      buildId,
      leadsLoaded: details.leads_loaded,
      leadsSupplied: details.leads_supplied,
    })
    if (!stable) return

    // Single-owner CAS (peerlyListId IS NULL): a no-op if a browser poll or
    // another replica stamped it first.
    await this.peerlyPhoneListCapture.stampPeerlyListId(
      token,
      listId,
      details.leads_loaded,
    )

    // FINALIZE edge (b): the list is now `ready`. A p2p draft paid before this
    // build finished was not submitted to Peerly at the webhook (finalize
    // deferred on a null phoneListId); stamp its id onto the draft and submit it
    // now. Runs before the capture edge so the draft's phoneListId is stamped
    // before the capture half reads it. Self-gated + best-effort; the backstop
    // sweep retries on failure.
    try {
      await this.p2pSmsCapture.finalizeDraftsForReadyList(listId)
    } catch (err) {
      this.logger.error(
        { err, buildId, listId },
        'win sms pre-build finalize (build-ready edge) failed; backstop sweep will retry',
      )
    }

    // CAPTURE edge (b): the list is now `ready` with a stable count. If a Win
    // SMS hold is already `authorized` for it, capture it now (the backstop
    // sweep catches it otherwise). Self-gated on the flag, so inert until the
    // cutover. Best-effort — a capture failure must not abort the finisher,
    // which only advances builds to `ready`.
    try {
      await this.p2pSmsCapture.captureHoldsForReadyList(listId)
    } catch (err) {
      this.logger.error(
        { err, buildId, listId },
        'win sms capture (build-ready edge) failed; backstop sweep will retry',
      )
    }
  }

  // FIFO group per build, so a build's own redeliveries/retries serialize
  // rather than racing each other through the claim CAS. `attempt` only
  // varies the deduplicationId — SQS's dedup window would otherwise collapse
  // a genuine retry (after a prior one failed) with the original message.
  private async enqueueBuild(buildId: string, attempt: number): Promise<void> {
    await this.queueProducer.sendMessage(
      { type: QueueType.P2P_PHONE_LIST_BUILD, data: { buildId } },
      `${MessageGroup.p2pPhoneListBuild}-${buildId}`,
      {
        throwOnError: true,
        deduplicationId: `${QueueType.P2P_PHONE_LIST_BUILD}-${buildId}-attempt-${attempt}`,
      },
    )
  }

  // Resolves a persisted voterFileFilterId into the full saved-segment
  // criteria, inline fields overriding — mirroring how getListDetail resolves
  // a persisted filter. Without this the id would be captured while the list
  // silently ran against the whole district. Returns null (never throws) so
  // each caller decides how to surface "not found": a synchronous 400 before
  // any row exists on the sync path, a `failed` build after the row exists
  // on the async path.
  private async resolveFilterInput(
    filterInput: P2pPhoneListFilterInput,
    organizationSlug: string,
  ): Promise<ContactsFilterResolutionInput | null> {
    if (!filterInput.voterFileFilterId) return filterInput
    const filter =
      await this.voterFileFilterService.findByIdAndOrganizationSlug(
        filterInput.voterFileFilterId,
        organizationSlug,
      )
    if (!filter) return null
    return { ...filter, ...filterInput }
  }

  // The shared build+upload tail: resolve → CSV → Peerly upload → record.
  // Called from the synchronous request path (isInteractive: true) and from
  // the queued build handler (isInteractive: false, and possibly carrying
  // existingToken from a prior incomplete attempt).
  private async runBuild(params: {
    buildId: string
    campaignId: number
    organization: Organization
    peerlyIdentityId: string
    listName: string
    resolvedFilterInput: ContactsFilterResolutionInput
    excludePersonIds: Set<string>
    isInteractive: boolean
    existingToken?: string
  }): Promise<string> {
    const {
      buildId,
      campaignId,
      organization,
      peerlyIdentityId,
      listName,
      resolvedFilterInput,
      excludePersonIds,
      isInteractive,
      existingToken,
    } = params

    // HARD SEND CAP (Win SMS hold, team decision 2 — never oversend): the
    // uploaded list must not exceed what was billed, even if re-resolving the
    // filter here yields a larger audience than the pre-pay estimate. Caps the
    // recipients at the paid count the hold covers.
    //
    // ORDER-INDEPENDENT (slice D2b): the cap is persisted on the build at
    // checkout-session creation (resolveSendCapForBuild reads that
    // `sendCapTexts` field), which always precedes the completed payment — and
    // thus the payment-webhook hold link. So the cap is present here whether this
    // resolve runs before or after the hold link, closing the race where the
    // first async build pass beat the webhook and uploaded uncapped. The only
    // ordering with no persisted cap is a resolve that runs before the user even
    // reaches checkout (resolve-before-estimate); there the pre-pay estimate is a
    // genuine upper bound of this already-smaller resolve, so uncapped is safe.
    const sendCap = await this.p2pSmsCapture.resolveSendCapForBuild(buildId)

    let phoneList: {
      csvBuffer: Buffer
      recipients: PhoneListRecipient[]
      excludedDuplicatePhoneCount: number
    }
    try {
      phoneList = await this.buildPhoneList(
        resolvedFilterInput,
        organization,
        excludePersonIds,
        isInteractive,
        sendCap,
      )
    } catch (error) {
      // The row's buildError mirrors whatever is ABOUT TO BE thrown to the
      // caller, never the raw caught `error` — that raw error can carry
      // vendor/internal detail (a people-api message, a stack-bearing
      // Error) this endpoint has never put in a client-facing response,
      // and a future poller reading buildError is still a client.
      if (error instanceof HttpException) {
        this.logger.warn(
          { error },
          `CSV generation rejected for campaign ${campaignId} (HttpException passthrough)`,
        )
        await this.markBuildFailed(buildId, error)
        throw error
      }
      this.logger.error(
        { error },
        `Failed to generate voter data for phone list, campaign ${campaignId}:`,
      )
      if (!isInteractive) {
        // Async path: an unclassified error here (people-db, network) is
        // TRANSIENT — rethrow raw so the queue handler redelivers rather
        // than parking a build that would have succeeded on retry. The
        // synchronous path below keeps wrapping this as a 400 (unchanged).
        throw error
      }
      const buildError = new BadRequestException(
        'Failed to generate voter data for phone list',
      )
      await this.markBuildFailed(buildId, buildError)
      throw buildError
    }
    const { csvBuffer, recipients, excludedDuplicatePhoneCount } = phoneList
    if (recipients.length === 0) {
      const emptyAudienceError = new BadRequestException(
        'No contacts matched the filter with a valid phone number and ' +
          'complete address — narrow the filter or check your contact data.',
      )
      await this.markBuildFailed(buildId, emptyAudienceError)
      throw emptyAudienceError
    }

    let token: string
    if (existingToken) {
      // A redelivery after Peerly already accepted this exact list (stamped
      // by a prior attempt that didn't finish recordUpload) — never upload
      // it twice.
      token = existingToken
    } else {
      try {
        token = await this.peerlyPhoneListService.uploadPhoneList({
          listName,
          csvBuffer,
          identityId: peerlyIdentityId,
        })
      } catch (error) {
        this.logger.error(
          { error },
          `Failed to upload phone list to Peerly for campaign ${campaignId}:`,
        )
        if (!isInteractive && !(error instanceof BadRequestException)) {
          // Transient: a Peerly 5xx/network error, or anything the vendor
          // layer didn't classify as a 4xx/validation rejection. The sync
          // path below always wraps this as a 502 (unchanged).
          throw error
        }
        const buildError =
          error instanceof BadRequestException
            ? error
            : new BadGatewayException(
                'Failed to upload phone list to Peerly platform',
              )
        await this.markBuildFailed(buildId, buildError)
        throw buildError
      }

      // Stamped BEFORE the (slower) recipients write, so a crash between the
      // two leaves a `building` row that still carries proof Peerly already
      // has this exact list — the existingToken branch above is what reads
      // this back.
      await this.peerlyPhoneListCapture.stampBuildToken(buildId, token)
    }

    // Capture rows are only written once Peerly confirms it has the list.
    //
    // The reported count is the candidate opt-out set size, not a
    // post-composition truth: if this org's support-status "unknown"
    // notIn resolution is itself large, ContactsService may drop the
    // opt-out merge to stay under people-api's id-filter cap
    // (excludePersonIdsFromResolution) — logged loudly there, but this
    // count won't reflect it. Rare (both sets have to be near-cap at
    // once) and acceptable for the observability this column exists for.
    await this.peerlyPhoneListCapture.recordUpload({
      buildId,
      token,
      recipients,
      excludedOptedOutCount: excludePersonIds.size,
      excludedDuplicatePhoneCount,
    })

    this.logger.debug(
      `P2P phone list uploaded successfully for campaign ${campaignId}, token: ${token}, buildId: ${buildId}`,
    )

    return token
  }

  // Best-effort: a DB write failing here must not mask the build/upload
  // error the caller is about to see (that's the one that matters), so this
  // only logs on failure. Callers pass the exact error being thrown to the
  // HTTP caller — never a raw internal one — so `buildError` never carries
  // more detail than the response a client already gets today; truncated
  // regardless, since it's a status field a poller reads, not a log sink.
  private async markBuildFailed(
    buildId: string,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    await this.peerlyPhoneListCapture
      .markBuildFailed(buildId, message.slice(0, 500))
      .catch((markError: Error) =>
        this.logger.error(
          { markError, buildId },
          'Failed to mark phone list build as failed; row left in a prior build state',
        ),
      )
  }

  private async buildPhoneList(
    filterInput: ContactsFilterResolutionInput,
    organization: Organization,
    excludePersonIds: Set<string>,
    isInteractive: boolean,
    // The Win SMS hold send cap: stop resolving recipients once this many have
    // been collected, so the uploaded list never exceeds the paid count. Null
    // applies no cap (flag off, or no hold authorized for this build yet).
    sendCap: number | null = null,
  ): Promise<{
    csvBuffer: Buffer
    recipients: PhoneListRecipient[]
    excludedDuplicatePhoneCount: number
  }> {
    const recipients: PhoneListRecipient[] = []
    const rows = [CSV_HEADER_ROW]

    const audience = resolveFilterAudience(this.contactsService, {
      filterInput,
      organization,
      dataset: await this.contactsService.resolvePeopleDataset(organization),
      excludePersonIds,
      pageSize: SEGMENT_PAGE_SIZE,
      maxRecipients: MAX_PHONE_LIST_RECIPIENTS,
      isEligible: hasGeoTargetableAddress,
      limitExceededMessage:
        `This filter matches over the ${MAX_PHONE_LIST_RECIPIENTS} ` +
        `phone-list limit — narrow the filter and try again.`,
      // Only the interactive (synchronous) path has an official sat in
      // front of it waiting for a token, so only it gets a clock. The
      // queued build has no deadline — it genuinely completes however long
      // it takes — and must skip the page-1 preflight cap too: that cap
      // refuses a filter it projects won't finish inside an HTTP gateway's
      // timeout, which is a regression (not a safety net) for a caller with
      // no gateway in front of it (see audienceResolution.util.ts's
      // `skipPreflightCap` doc).
      ...(isInteractive
        ? {
            // The cap alone did not bound one: 100,000 recipients is 100
            // pages and the gateway hangs up at ~120s, so a filter matching
            // ~82,000 passed every guard, died with no response, and then
            // finished anyway — uploading a phone list to Peerly 45.9s
            // after the browser had already shown a failure (INC-101).
            // Nothing deletes that list, and the retry it invites makes a
            // second one.
            timeBudgetMs: MAX_INTERACTIVE_RESOLUTION_MS,
            budgetExceededMessage: ({
              matchedCount,
              affordableCount,
            }: {
              matchedCount: number
              affordableCount: number
            }) =>
              `This filter matches ${matchedCount} contacts — too many to ` +
              `build a phone list while you wait (about ${affordableCount} ` +
              `right now). Narrow the filter and try again.`,
          }
        : { skipPreflightCap: true }),
    })

    let next = await audience.next()
    while (!next.done) {
      // SEND CAP: stop at the paid count so the uploaded list (and the Peerly
      // send that reads it) never exceeds what the hold authorized. A capped-down
      // send is fine — we charge the hold and send the hold's worth.
      if (sendCap !== null && recipients.length >= sendCap) break
      const person = next.value
      recipients.push({ personId: person.id, phone: person.cellPhone })
      rows.push(
        [
          person.firstName,
          person.lastName,
          person.cellPhone,
          person.address.state,
          person.address.city,
          person.address.zip,
        ]
          .map(csvEscape)
          .join(','),
      )
      next = await audience.next()
    }

    return {
      csvBuffer: Buffer.from(rows.join('\n') + '\n', 'utf-8'),
      recipients,
      // The duplicate-phone tally is only available from the generator's return
      // value, which requires exhausting it. A cap-truncated build breaks early,
      // so that observability count is reported as 0 rather than a partial tally.
      excludedDuplicatePhoneCount: next.done
        ? next.value.excludedDuplicatePhoneCount
        : 0,
    }
  }

  // ENG-10800: a person who opted out of a past text/p2p send in this org
  // must not land on the next phone list — the inbound sweep records the
  // opt-out but nothing consumed it at send time before this. The scrub is
  // best-effort against people-api's id-filter cap: an org with more
  // opt-outs than the cap must still be able to send, so a set that large
  // skips the scrub (logged loudly) rather than 400ing the send.
  private async resolveOptOutScrub(
    organizationSlug: string,
  ): Promise<Set<string>> {
    const optedOutIds =
      await this.contactInteractionTextService.findOptedOutPersonIds(
        organizationSlug,
      )
    if (optedOutIds.length === 0) return new Set()
    if (optedOutIds.length > MAX_RESOLVED_ID_SET_SIZE) {
      this.logger.warn(
        { organizationSlug, optedOutCount: optedOutIds.length },
        'Opt-out scrub set exceeds the people-api id-filter cap — skipping ' +
          'the scrub for this phone-list build rather than blocking the send',
      )
      return new Set()
    }
    return new Set(optedOutIds)
  }
}
