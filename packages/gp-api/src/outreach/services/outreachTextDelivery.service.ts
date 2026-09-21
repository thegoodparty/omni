import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { format, isValid, parseISO } from 'date-fns'
import parseCsv from 'neat-csv'
import { MAX_RESOLVED_ID_SET_SIZE } from '@/contactInteraction/services/activityConditionResolution.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import {
  ContactsFilterResolutionInput,
  ContactsService,
} from '@/contacts/services/contacts.service'
import type { PersonOutput } from '@/contacts/schemas/person.schema'
import { resolveFilterAudience } from '@/contacts/utils/audienceResolution.util'
import { Organization, OutreachStatus, User } from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { csvEscape } from '@/shared/util/csv.util'
import { normalizePhoneNumber } from '@/shared/util/strings.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import {
  TEXT_DELIVERY_HANDOFF_PORT,
  TextDeliveryHandoffPort,
} from '../interfaces/textDeliveryHandoff.interface'

/**
 * The shared delivery layer's outbound half. Knows nothing about polls or
 * SMS: it resolves an audience, scrubs opt-outs, dedupes by phone, captures
 * the phone-to-person map, and hands the send to fulfilment.
 *
 * The test for whether something belongs here: would it still be true if we
 * swapped Slack for a real vendor? Scrubbing opt-outs, yes. Ranking themes,
 * no — that is the polls layer.
 *
 * See docs/features/serve-sms.md, "Layer 1: Delivery".
 */

/**
 * Who to reach. The product resolves its own audience; delivery owns what
 * happens to it.
 *
 * The sample branch exists on day one even though only polls will pass one,
 * and nothing calls it that way yet. That is deliberate: if the sample branch
 * does not work, the layer is not actually shared, and we would not find out
 * until polls tried to move onto it.
 */
export type TextDeliveryAudience =
  | { kind: 'savedFilter'; voterFileFilterId: number }
  | { kind: 'sample'; size: number; excludePersonIds?: string[] }

export interface RequestSendInput {
  /** The envelope. Org-scoped; a Serve row carries no campaignId. */
  outreachId: number
  audience: TextDeliveryAudience
  /** Sent verbatim. Delivery never edits the message. */
  message: string
  imageUrl?: string
  /** Local calendar day, "YYYY-MM-DD". Serve sends at a fixed 11am local. */
  scheduledLocalDate: string
  /** 1, then incremented per expansion. Keys the CSV so retries reuse it. */
  sendSeq: number
}

export interface RequestSendResult {
  /**
   * Whether this call resolved the audience, which is what makes the two
   * `excluded*` counts mean anything. False when the CSV a previous attempt
   * wrote was reused, and false when the spine refused the send — neither
   * resolves anything, so both counts are 0 meaning "not measured" rather
   * than "none". Without this a caller cannot tell the two apart.
   */
  audienceResolved: boolean
  recipientCount: number
  /**
   * How many people THIS audience lost to the opt-out scrub: they matched
   * the filter, had a cell phone, and were dropped for having opted out.
   *
   * Not the size of the org's opt-out list. An org with 1,000 historical
   * opt-outs whose filter reaches 5 of them reports 5.
   */
  excludedOptedOutCount: number
  excludedDuplicateCount: number
  /** The deterministic S3 key this send's recipient CSV was written under. */
  sendKey: string
  /**
   * Set only when nothing was handed off and never will be, so the caller
   * acks rather than redelivering. `not_sendable` is the spine refusing the
   * claim — canceled, unpaid, or already sent — and leaves the row where it
   * was. `send_failed` is a send that cannot be made at all (see the 4xx
   * rule in `requestSend`) and leaves the row `failed`.
   */
  terminalReason?: 'not_sendable' | 'send_failed'
}

/**
 * The shape fulfilment already receives from polls (`buildCsvFromContacts`
 * in queueConsumer.service.ts). Kept byte-identical so the human on the other
 * end of the handoff does not learn a second format when polls moves onto
 * this layer.
 */
const CSV_COLUMNS = ['id', 'firstName', 'lastName', 'cellPhone'] as const

/**
 * Widened to `number` on purpose: `HttpException.getStatus()` returns a plain
 * number, and comparing it against the enum member trips
 * `no-unsafe-enum-comparison`.
 */
const SERVER_ERROR_FLOOR: number = HttpStatus.INTERNAL_SERVER_ERROR

/**
 * Where the recipient CSVs live. The dedicated name is preferred so the
 * shared layer is not spelled after one of its two products, with the poll
 * bucket as the fallback that already exists in every environment — the
 * object is an idempotency record, not a deliverable, so the two products
 * sharing one bucket is fine. Split them by setting the first var.
 */
const resolveBucket = (): string => {
  const bucket =
    process.env.OUTREACH_TEXT_CSVS_BUCKET || process.env.TEVYN_POLL_CSVS_BUCKET
  if (!bucket) {
    throw new Error(
      'OUTREACH_TEXT_CSVS_BUCKET (or TEVYN_POLL_CSVS_BUCKET) is required to ' +
        'hand off a text send',
    )
  }
  return bucket
}

/**
 * The only spine status a send may start from: what the purchase handler's
 * `pending_payment → pending` CAS leaves behind. Anything else means the row
 * was canceled, is already sending, or was never paid for, and none of those
 * may reach fulfilment.
 *
 * An expansion (`sendSeq > 1`) is its own trigger's problem: it has to return
 * the row to `pending` before enqueueing, the way the purchase handler does.
 */
const SENDABLE_STATUS = OutreachStatus.pending

type ResolvedRecipient = {
  personId: string
  firstName: string | null
  lastName: string | null
  cellPhone: string
}

type ResolvedAudience = {
  recipients: ResolvedRecipient[]
  excludedDuplicateCount: number
  excludedOptedOutCount: number
}

const toRecipient = (
  person: PersonOutput & { cellPhone: string },
): ResolvedRecipient => ({
  personId: person.id,
  firstName: person.firstName ?? null,
  lastName: person.lastName ?? null,
  cellPhone: person.cellPhone,
})

const buildRecipientCsv = (recipients: ResolvedRecipient[]): string => {
  const lines = [CSV_COLUMNS.join(',')]
  for (const recipient of recipients) {
    lines.push(
      [
        recipient.personId,
        recipient.firstName,
        recipient.lastName,
        recipient.cellPhone,
      ]
        .map(csvEscape)
        .join(','),
    )
  }
  return lines.join('\n')
}

/**
 * A calendar day rendered for a human, with no timezone arithmetic: `parseISO`
 * on a date-only string produces local midnight, so formatting it can never
 * shift the day the way a UTC instant would. The send TIME is a product
 * constant (Serve sends at 11am local) and is deliberately not stated here —
 * the delivery layer does not know which product it is carrying.
 */
const formatScheduledDate = (scheduledLocalDate: string): string => {
  const parsed = parseISO(scheduledLocalDate)
  return isValid(parsed) ? format(parsed, 'PP') : scheduledLocalDate
}

// Based on OutreachTextRecipient: the phone-to-person map is the only table
// this service owns outright, and `this.client` reaches the spine and the
// organization it also has to read.
@Injectable()
export class OutreachTextDeliveryService extends createPrismaBase(
  MODELS.OutreachTextRecipient,
) {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly voterFileFilterService: VoterFileFilterService,
    private readonly contactInteractionTextService: ContactInteractionTextService,
    private readonly s3Service: S3Service,
    @Inject(TEXT_DELIVERY_HANDOFF_PORT)
    private readonly handoffPort: TextDeliveryHandoffPort,
  ) {
    super()
  }

  /**
   * Resolve, scrub, capture, hand off. Idempotent: a redelivered queue
   * message reuses the CSV at `sendKey` rather than resampling a different
   * audience, and both capture writes are skipDuplicates.
   *
   * Both `excluded*` counts are byproducts of resolution, so a call that
   * reuses a previous attempt's CSV reports 0 for each and flags
   * `audienceResolved: false`. Read that flag before reading the counts.
   *
   * Never throws for a condition redelivery cannot fix. The only caller is
   * the SQS consumer, and a throw there is a requeue, so a permanent fault
   * would spend the whole redrive budget on its way to the DLQ. Those come
   * back as a `terminalReason` instead. Transient faults still throw.
   */
  async requestSend(input: RequestSendInput): Promise<RequestSendResult> {
    const { outreachId, sendSeq } = input
    // Deterministic on (outreach, send), so a redelivered queue message
    // reuses this object instead of resampling a different audience. Polls
    // keys on an estimated completion date it relies on never changing; an
    // explicit counter beats a timestamp that happens to be stable.
    const sendKey = `${outreachId}-${sendSeq}.csv`

    try {
      return await this.runSend(input, sendKey)
    } catch (error) {
      // A 4xx out of this path describes the DATA, not the infrastructure: a
      // deleted outreach, an organization that does not exist, a saved list
      // that was removed, an audience that scrubs down to nobody. A
      // redelivery reads the same rows and fails the same way, so retrying
      // only burns the redrive budget. Everything else — S3, Slack, Prisma,
      // any 5xx — may well be transient and keeps its retry.
      if (
        !(error instanceof HttpException) ||
        error.getStatus() >= SERVER_ERROR_FLOOR
      ) {
        throw error
      }
      // Not a revert to `pending`. Nothing re-enqueues a pending row, and a
      // Serve row carries no phone list, so `pending` renders "In review" —
      // it would tell the official a human is working a send that can never
      // go out. `failed` already renders "Couldn't send".
      await this.client.outreach.updateMany({
        where: {
          id: outreachId,
          status: {
            in: [OutreachStatus.pending, OutreachStatus.in_progress],
          },
        },
        data: { status: OutreachStatus.failed },
      })
      this.logger.error(
        { outreachId, sendSeq, sendKey, err: error },
        'Text send failed permanently; the row is now failed. It is already ' +
          'paid, so this one needs a refund decision.',
      )
      return {
        audienceResolved: false,
        recipientCount: 0,
        excludedOptedOutCount: 0,
        excludedDuplicateCount: 0,
        sendKey,
        terminalReason: 'send_failed',
      }
    }
  }

  /**
   * The send itself. Split out so `requestSend` is only the terminal-vs-
   * transient decision and this is only the happy path plus the claim.
   */
  private async runSend(
    input: RequestSendInput,
    sendKey: string,
  ): Promise<RequestSendResult> {
    const { outreachId, sendSeq } = input
    const { organization, official } = await this.loadSendContext(outreachId)

    // CLAIM before anything irreversible, rather than checking the status at
    // the end. A read would not be enough and the trailing CAS was not
    // enough: a candidate can cancel between the check and the handoff, and
    // by then a human has the CSV and will send it. Claiming closes that
    // window, because `cancelOutreach` is `pending`-only — once this row
    // reads `in_progress` a cancel is refused rather than racing the send.
    //
    // The claim IS the spine advance; there is no separate "claimed" state to
    // add. A redelivered message, or a message for a canceled / unpaid /
    // already-sent row, matches nothing and does no work.
    const claimed = await this.client.outreach.updateMany({
      where: { id: outreachId, status: SENDABLE_STATUS },
      data: { status: OutreachStatus.in_progress },
    })
    if (claimed.count === 0) {
      this.logger.warn(
        { outreachId, sendSeq },
        'Text send skipped: the outreach was not pending, so it is canceled, ' +
          'unpaid, or already sent. Nothing was written or handed off.',
      )
      return {
        audienceResolved: false,
        recipientCount: 0,
        excludedOptedOutCount: 0,
        excludedDuplicateCount: 0,
        sendKey,
        terminalReason: 'not_sendable',
      }
    }

    try {
      return await this.runClaimedSend(input, {
        organization,
        official,
        sendKey,
      })
    } catch (error) {
      // Hand the claim back so a transient fault can retry. Guarded on
      // `in_progress`, which can only be this send's own claim: the queue is
      // FIFO with a per-outreach message group, so two deliveries for one
      // outreach serialize, and a cancel cannot have landed while the row
      // was claimed. `requestSend` decides whether the retry actually
      // happens or the row goes to `failed` instead.
      await this.client.outreach.updateMany({
        where: { id: outreachId, status: OutreachStatus.in_progress },
        data: { status: SENDABLE_STATUS },
      })
      throw error
    }
  }

  /**
   * Everything after the claim. Split out so the claim's revert wraps the
   * whole irreversible stretch in one place rather than a catch per step.
   */
  private async runClaimedSend(
    input: RequestSendInput,
    context: { organization: Organization; official: User; sendKey: string },
  ): Promise<RequestSendResult> {
    const {
      outreachId,
      audience,
      message,
      imageUrl,
      scheduledLocalDate,
      sendSeq,
    } = input
    const { organization, official, sendKey } = context
    const organizationSlug = organization.slug

    const excludePersonIds = await this.resolveOptOutScrub(organizationSlug)

    const bucket = resolveBucket()
    let csv = await this.s3Service.getFile(bucket, sendKey)
    let audienceResolved = false
    let excludedDuplicateCount = 0
    let excludedOptedOutCount = 0

    if (csv) {
      this.logger.info(
        { outreachId, sendSeq, sendKey },
        'Reusing the recipient CSV from a previous attempt at this send',
      )
    } else {
      const resolved = await this.resolveAudience(
        audience,
        organization,
        excludePersonIds,
      )
      if (resolved.recipients.length === 0) {
        // Nothing is written and nothing is handed off. A 4xx, so
        // `requestSend` lands the row in `failed` and the consumer acks.
        throw new BadRequestException(
          'No contacts matched this send with a valid cell phone after the ' +
            'opt-out scrub.',
        )
      }
      audienceResolved = true
      excludedDuplicateCount = resolved.excludedDuplicateCount
      excludedOptedOutCount = resolved.excludedOptedOutCount
      csv = buildRecipientCsv(resolved.recipients)
      await this.s3Service.uploadFile(bucket, csv, sendKey, {
        contentType: 'text/csv',
      })
    }

    // Read the recipients back out of the CSV rather than off the resolution,
    // so the capture rows describe the file fulfilment actually receives on
    // both the fresh and the reused path.
    const captured = await this.parseRecipients(csv, outreachId)

    const occurredAt = new Date()
    await this.model.createMany({
      data: captured.map((recipient) => ({
        outreachId,
        organizationSlug,
        personId: recipient.personId,
        phone: recipient.phone,
      })),
      // (outreachId, personId) is unique, so a redelivered message is a
      // no-op here rather than a duplicate.
      skipDuplicates: true,
    })
    await this.contactInteractionTextService.createManyIdempotent(
      captured.map((recipient) => ({
        organizationSlug,
        personId: recipient.personId,
        outreachId,
        occurredAt,
      })),
    )

    await this.handoffPort.send({
      outreachId: String(outreachId),
      sendSeq,
      message,
      scheduledDate: formatScheduledDate(scheduledLocalDate),
      recipientCount: captured.length,
      csv: {
        fileContent: Buffer.from(csv),
        filename: `${official.email}-${scheduledLocalDate}-send-${sendSeq}.csv`,
      },
      imageUrl,
      officialInfo: {
        name: `${official.firstName ?? ''} ${official.lastName ?? ''}`.trim(),
        email: official.email,
        phone: official.phone ?? undefined,
      },
    })

    return {
      audienceResolved,
      recipientCount: captured.length,
      excludedOptedOutCount,
      excludedDuplicateCount,
      sendKey,
    }
  }

  /**
   * The envelope's organization, and the person the send is from.
   *
   * The official is the organization's owner rather than
   * `ElectedOffice.userId`: every organization has exactly one owner, so the
   * lookup stays the same for a Serve org and a Win campaign org, and the
   * layer does not have to know which product it is carrying. For an elected
   * office org they are the same user.
   */
  private async loadSendContext(outreachId: number): Promise<{
    organization: Organization
    official: User
  }> {
    const outreach = await this.client.outreach.findUnique({
      where: { id: outreachId },
      select: {
        organizationSlug: true,
        campaign: { select: { organizationSlug: true } },
      },
    })
    if (!outreach) {
      throw new NotFoundException(`Outreach ${outreachId} not found`)
    }
    // Legacy Win rows carry no organizationSlug and resolve it through the
    // campaign join (see the outreach_scope_check invariant).
    const organizationSlug =
      outreach.organizationSlug ?? outreach.campaign?.organizationSlug
    if (!organizationSlug) {
      throw new BadRequestException(
        `Outreach ${outreachId} has no organization to send on behalf of`,
      )
    }

    const organization = await this.client.organization.findUnique({
      where: { slug: organizationSlug },
      include: { owner: true },
    })
    if (!organization) {
      throw new NotFoundException(
        `Organization ${organizationSlug} not found for outreach ${outreachId}`,
      )
    }

    return { organization, official: organization.owner }
  }

  /**
   * ENG-10800: a person who opted out of a past text send in this org must
   * not land on the next one.
   *
   * Unlike `P2pPhoneListUploadService.resolveOptOutScrub`, an over-cap set is
   * NOT dropped here. That cap exists because Win sends the ids to people-api
   * as an id filter; the saved-filter branch below applies this set
   * in-process instead, so the vendor limit does not apply and a large org
   * gets a real scrub rather than none. The only remaining truncation is the
   * `LIMIT` inside `findOptedOutPersonIds`, which is loud rather than silent.
   */
  private async resolveOptOutScrub(
    organizationSlug: string,
  ): Promise<Set<string>> {
    const optedOutIds =
      await this.contactInteractionTextService.findOptedOutPersonIds(
        organizationSlug,
      )
    if (optedOutIds.length > MAX_RESOLVED_ID_SET_SIZE) {
      this.logger.warn(
        { organizationSlug, optedOutCount: optedOutIds.length },
        'Opt-out set hit the query limit — the scrub is still applied but ' +
          'may be incomplete for this send',
      )
    }
    return new Set(optedOutIds)
  }

  private resolveAudience(
    audience: TextDeliveryAudience,
    organization: Organization,
    excludePersonIds: Set<string>,
  ): Promise<ResolvedAudience> {
    return audience.kind === 'savedFilter'
      ? this.resolveSavedFilterAudience(
          audience.voterFileFilterId,
          organization,
          excludePersonIds,
        )
      : this.resolveSampleAudience(audience, organization, excludePersonIds)
  }

  /** SMS today, polls later. */
  private async resolveSavedFilterAudience(
    voterFileFilterId: number,
    organization: Organization,
    excludePersonIds: Set<string>,
  ): Promise<ResolvedAudience> {
    const filter =
      await this.voterFileFilterService.findByIdAndOrganizationSlug(
        voterFileFilterId,
        organization.slug,
      )
    if (!filter) {
      throw new BadRequestException(
        'Saved list not found for this organization',
      )
    }
    const filterInput: ContactsFilterResolutionInput = filter

    const recipients: ResolvedRecipient[] = []
    let excludedOptedOutCount = 0

    // `for await...of` discards a generator's RETURN value, and the duplicate
    // count is the return value — drive the iterator by hand.
    const resolution = resolveFilterAudience(this.contactsService, {
      filterInput,
      organization,
      // Empty on purpose, with the scrub applied through `isEligible`
      // instead. Handing the ids to people-api as an exclusion filter means
      // those rows never come back, so the layer can only ever report how
      // many people the ORG has opted out — not how many THIS audience lost,
      // which is the number the official is shown before paying. Scrubbing
      // in-process is what makes the honest count computable. It also drops
      // the vendor's id-filter cap (a big org is scrubbed rather than
      // skipped) and the id-set contention `excludePersonIdsFromResolution`
      // warns about. The cost is that opted-out rows are paged over before
      // being discarded.
      excludePersonIds: new Set(),
      // Runs after the cell-phone check and before dedupe/cap, so an
      // opted-out person neither claims a phone number nor spends a
      // recipient — the same position the upstream filter had.
      isEligible: (person) => {
        if (!excludePersonIds.has(person.id)) return true
        excludedOptedOutCount += 1
        return false
      },
      limitExceededMessage:
        'This list is over the recipient limit for one send — narrow it and ' +
        'try again.',
    })
    let next = await resolution.next()
    while (!next.done) {
      recipients.push(toRecipient(next.value))
      next = await resolution.next()
    }

    return {
      recipients,
      excludedDuplicateCount: next.value.excludedDuplicatePhoneCount,
      excludedOptedOutCount,
    }
  }

  /**
   * District-wide random sample, with `hasCellPhone` forced inside
   * `sampleContacts`. Nothing calls this yet — polls needs it when it moves
   * onto this layer, and a branch that is never exercised is a branch that
   * does not work.
   */
  private async resolveSampleAudience(
    audience: Extract<TextDeliveryAudience, { kind: 'sample' }>,
    organization: Organization,
    excludePersonIds: Set<string>,
  ): Promise<ResolvedAudience> {
    // The sample branch keeps sending exclusions UPSTREAM, unlike the filter
    // branch. A sample is a request for N people, so the scrub has to narrow
    // the pool the sample is drawn FROM; scrubbing afterwards would return
    // fewer than N. That makes `excludedOptedOutCount` 0 here and correct: a
    // caller asking for N still gets N, so this audience lost nobody.
    //
    // It does mean this branch inherits people-api's id-filter cap on the
    // exclusion list, which the filter branch no longer has. Polls has to
    // resolve that when it adopts this layer; nothing calls it today.
    const excludeIds = [
      ...new Set([...excludePersonIds, ...(audience.excludePersonIds ?? [])]),
    ]
    const sample = await this.contactsService.sampleContacts(
      { size: audience.size, excludeIds },
      organization,
    )

    // Dedupe by phone here too, for the same reason the filter branch does:
    // the capture row is a phone-to-person map, and two people on one number
    // make an inbound reply unattributable.
    const seenPhones = new Set<string>()
    const recipients: ResolvedRecipient[] = []
    let excludedDuplicateCount = 0
    for (const person of sample) {
      if (!person.cellPhone) continue
      if (seenPhones.has(person.cellPhone)) {
        excludedDuplicateCount += 1
        continue
      }
      seenPhones.add(person.cellPhone)
      recipients.push(toRecipient({ ...person, cellPhone: person.cellPhone }))
    }

    return { recipients, excludedDuplicateCount, excludedOptedOutCount: 0 }
  }

  /**
   * The CSV back as capture rows. Phones are normalized because the inbound
   * side looks a reply up by number, and a row we cannot key on is worse than
   * no row — skipped and logged rather than thrown, so one malformed line
   * cannot block the whole send. (`normalizePhoneNumber` throws on anything
   * that is not ten digits, which is why the call is guarded.)
   */
  private async parseRecipients(
    csv: string,
    outreachId: number,
  ): Promise<{ personId: string; phone: string }[]> {
    const rows = await parseCsv<{ id?: string; cellPhone?: string }>(csv)
    const captured: { personId: string; phone: string }[] = []
    let skipped = 0
    for (const row of rows) {
      if (!row.id || !row.cellPhone) {
        skipped += 1
        continue
      }
      let phone: string
      try {
        phone = normalizePhoneNumber(row.cellPhone)
      } catch {
        skipped += 1
        continue
      }
      captured.push({ personId: row.id, phone })
    }
    if (skipped > 0) {
      this.logger.warn(
        { outreachId, skipped },
        'Recipient CSV rows without an id or a usable phone were not captured',
      )
    }
    return captured
  }
}
