import {
  BadRequestException,
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
  recipientCount: number
  excludedOptedOutCount: number
  excludedDuplicateCount: number
  /** The deterministic S3 key this send's recipient CSV was written under. */
  sendKey: string
}

/**
 * The shape fulfilment already receives from polls (`buildCsvFromContacts`
 * in queueConsumer.service.ts). Kept byte-identical so the human on the other
 * end of the handoff does not learn a second format when polls moves onto
 * this layer.
 */
const CSV_COLUMNS = ['id', 'firstName', 'lastName', 'cellPhone'] as const

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

type ResolvedRecipient = {
  personId: string
  firstName: string | null
  lastName: string | null
  cellPhone: string
}

type ResolvedAudience = {
  recipients: ResolvedRecipient[]
  excludedDuplicateCount: number
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
   * One count is weaker on the reuse path than on the first run.
   * `excludedOptedOutCount` is re-derived from the database every time, but
   * `excludedDuplicateCount` is a byproduct of resolution, and a reused
   * object was not resolved — it comes back 0. The number the customer was
   * quoted is the one captured at create time; these are observability for
   * the send itself.
   */
  async requestSend(input: RequestSendInput): Promise<RequestSendResult> {
    const {
      outreachId,
      audience,
      message,
      imageUrl,
      scheduledLocalDate,
      sendSeq,
    } = input

    const { organization, official } = await this.loadSendContext(outreachId)
    const organizationSlug = organization.slug

    const excludePersonIds = await this.resolveOptOutScrub(organizationSlug)

    const bucket = resolveBucket()
    // Deterministic on (outreach, send), so a redelivered queue message
    // reuses this object instead of resampling a different audience. Polls
    // keys on an estimated completion date it relies on never changing; an
    // explicit counter beats a timestamp that happens to be stable.
    const sendKey = `${outreachId}-${sendSeq}.csv`

    let csv = await this.s3Service.getFile(bucket, sendKey)
    let excludedDuplicateCount = 0

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
        // Nothing is written and nothing is handed off, so the row stays
        // `pending` and the send can be retried once the list is fixed.
        throw new BadRequestException(
          'No contacts matched this send with a valid cell phone after the ' +
            'opt-out scrub — widen the audience and try again.',
        )
      }
      excludedDuplicateCount = resolved.excludedDuplicateCount
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

    // CAS, guarded on `pending`: only the state the purchase handler leaves
    // behind advances. A redelivered message finds the row already
    // `in_progress` and leaves it alone, and a row canceled mid-flight is
    // never resurrected.
    const advanced = await this.client.outreach.updateMany({
      where: { id: outreachId, status: OutreachStatus.pending },
      data: { status: OutreachStatus.in_progress },
    })
    if (advanced.count === 0) {
      this.logger.info(
        { outreachId, sendSeq },
        'Text send handed off but the spine was not pending — leaving the ' +
          'status as it is',
      )
    }

    return {
      recipientCount: captured.length,
      excludedOptedOutCount: excludePersonIds.size,
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
   * ENG-10800, lifted from `P2pPhoneListUploadService.resolveOptOutScrub`:
   * a person who opted out of a past text send in this org must not land on
   * the next one. Best-effort against people-api's id-filter cap — an org
   * with more opt-outs than the cap must still be able to send, so a set that
   * large skips the scrub (logged loudly) rather than blocking delivery.
   */
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
          'the scrub for this send rather than blocking it',
      )
      return new Set()
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
    // `for await...of` discards a generator's RETURN value, and the duplicate
    // count is the return value — drive the iterator by hand.
    const resolution = resolveFilterAudience(this.contactsService, {
      filterInput,
      organization,
      excludePersonIds,
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
    // sampleContacts takes exclusions as ids rather than a set, so the
    // opt-out scrub and the caller's own exclusions merge into one list.
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

    return { recipients, excludedDuplicateCount }
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
