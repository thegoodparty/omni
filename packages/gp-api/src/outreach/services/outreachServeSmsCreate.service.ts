import { BadRequestException, Injectable } from '@nestjs/common'
import {
  ServeSmsCreateRequest,
  ServeSmsCreateResponse,
} from '@goodparty_org/contracts'
import { addBusinessDays, addDays, isWeekend } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { MAX_RESOLVED_ID_SET_SIZE } from '@/contactInteraction/services/activityConditionResolution.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import {
  ContactsFilterResolutionInput,
  ContactsService,
} from '@/contacts/services/contacts.service'
import {
  MAX_AUDIENCE_RECIPIENTS,
  resolveFilterAudience,
} from '@/contacts/utils/audienceResolution.util'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { ISO_DATE_ONLY_RE } from '@/shared/util/date.util'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { OutreachStatus, OutreachType } from '../../generated/prisma'

/**
 * The Serve SMS draft-first create: `POST /v1/outreach/serve/sms`.
 *
 * Persists one `Outreach` row as `pending_payment`, org-scoped
 * (`campaignId: null`), `outreachType: text`, and returns the counts the pay
 * step quotes. Payment is `OutreachServeSmsPurchaseHandlerService`; the send
 * itself is the delivery layer, reached from that handler's post-purchase
 * step.
 *
 * Draft-first is required, not preferred: a Stripe metadata VALUE caps at 500
 * characters and `SMS_COMPOSED_MAX_LENGTH` is 1000, so the poll pattern of
 * carrying the composed message through checkout metadata cannot work. The
 * row has to exist before checkout, and checkout then carries two ids.
 *
 * See docs/features/serve-sms.md, "Layer 2: SMS (Serve)" and "Send timing".
 */

/**
 * The floor the purchase handler cannot enforce for itself.
 *
 * The arithmetic floor is 15: `textPricing.util.ts` charges 35 tenth-cents a
 * recipient, so 14 recipients price at 49 cents and Stripe's minimum charge is
 * 50. 25 is that floor plus headroom, chosen so a send near the boundary does
 * not become un-payable if pricing ever moves, and so a list this small reads
 * as a mistake rather than a purchase.
 *
 * Enforced here rather than only in the picker: the picker's count is advisory
 * and the client is never trusted for the audience.
 */
export const MIN_SERVE_SMS_RECIPIENTS = 25

/** Serve sends at a fixed 11am local. Stated to the user, never chosen. */
export const SERVE_SMS_SEND_HOUR_LOCAL = 11

export const MIN_SERVE_SMS_LEAD_BUSINESS_DAYS = 2
export const MAX_SERVE_SMS_SCHEDULE_DAYS = 30

/**
 * Which "today" the schedule window is measured from.
 *
 * The picker measures against the USER's local midnight; gp-api runs in UTC,
 * which is ahead of every US timezone, so a server anchored on its own clock
 * would call a date stale that the picker had just offered — an evening
 * request would 400 on the earliest selectable day. Anchoring on Pacific makes
 * the server at worst a day more permissive than the picker for a user east of
 * it, which is the right direction to be wrong in: the cost is a send booked
 * with slightly less lead time, not a valid request rejected.
 *
 * Alaska and Hawaii are further west still and are not covered; the residual
 * is the same one-day edge, in the same direction the picker already allows.
 */
const SCHEDULE_REFERENCE_TIMEZONE = 'America/Los_Angeles'

type CalendarDate = { year: number; month: number; day: number }

// Local midnight, so every date-fns predicate below (which reads local
// getters) agrees with the calendar day it was built from regardless of the
// server's own timezone. Both sides of every comparison are built this way,
// so the arithmetic is purely calendrical.
const atLocalMidnight = ({ year, month, day }: CalendarDate): Date =>
  new Date(year, month - 1, day)

const parseCalendarDate = (value: string): Date => {
  if (!ISO_DATE_ONLY_RE.test(value)) {
    throw new BadRequestException(
      'Send date must be a calendar date in YYYY-MM-DD form',
    )
  }
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  const parsed = atLocalMidnight({ year, month, day })
  // Date rolls 2026-02-30 forward to March rather than failing, so compare the
  // components back: the regex proves the shape, this proves the day exists.
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    throw new BadRequestException(`${value} is not a real calendar date`)
  }
  return parsed
}

const referenceToday = (now: Date): Date => {
  const zoned = toZonedTime(now, SCHEDULE_REFERENCE_TIMEZONE)
  return atLocalMidnight({
    year: zoned.getFullYear(),
    month: zoned.getMonth() + 1,
    day: zoned.getDate(),
  })
}

/**
 * The server-side mirror of `getDisabledState` in
 * `app/dashboard/polls/components/PollScheduledDateSelector.tsx`, same
 * predicate in the same order, so Serve SMS and polls make the same promise
 * (decided 2026-09-21, see the TDD's "Send timing").
 *
 * A copy rather than an import: the rule lives in a webapp component this
 * package cannot reach, and gp-api must not trust the picker for it in any
 * case. Keep the two in step — the picker is the spelled-out version, this is
 * the enforced one.
 *
 * Exported for the tests, and so a future scheduling surface has one thing to
 * call rather than a second transcription.
 */
export function assertServeSmsSendDateAllowed(
  scheduledLocalDate: string,
  now: Date = new Date(),
): void {
  const date = parseCalendarDate(scheduledLocalDate)
  const today = referenceToday(now)

  // Strictly greater, exactly as the picker disables `date <= +2 business
  // days`: two clear business days of lead for fulfilment.
  if (date <= addBusinessDays(today, MIN_SERVE_SMS_LEAD_BUSINESS_DAYS)) {
    throw new BadRequestException(
      `Send date must be at least ${MIN_SERVE_SMS_LEAD_BUSINESS_DAYS} ` +
        'business days from today',
    )
  }
  if (date > addDays(today, MAX_SERVE_SMS_SCHEDULE_DAYS)) {
    throw new BadRequestException(
      `Cannot schedule more than ${MAX_SERVE_SMS_SCHEDULE_DAYS} days in advance`,
    )
  }
  if (isWeekend(date)) {
    throw new BadRequestException('Cannot schedule on the weekend')
  }
}

@Injectable()
export class OutreachServeSmsCreateService extends createPrismaBase(
  MODELS.Outreach,
) {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly organizationsService: OrganizationsService,
    private readonly voterFileFilterService: VoterFileFilterService,
    private readonly contactInteractionTextService: ContactInteractionTextService,
  ) {
    super()
  }

  /**
   * Create the draft. The only client input that reaches the audience is the
   * saved list's id — the count is resolved from that list here and written to
   * `Outreach.textCount`, which is what
   * `OutreachServeSmsPurchaseHandlerService.calculateAmount` re-reads and
   * prices. A count in the request body is stripped by the create schema and
   * would be ignored regardless.
   *
   * There is deliberately no edit route: a draft is immutable while
   * `pending_payment`, so re-entering the flow creates a fresh draft rather
   * than repricing an existing one behind a checkout session that may already
   * be open against it.
   */
  async createDraft(
    organizationSlug: string,
    input: ServeSmsCreateRequest,
  ): Promise<ServeSmsCreateResponse> {
    // Cheapest rejection first: no point resolving an audience for a date
    // fulfilment cannot work.
    assertServeSmsSendDateAllowed(input.scheduledLocalDate)

    const organization = await this.organizationsService.findFirst({
      where: { slug: organizationSlug },
    })
    if (!organization) {
      throw new BadRequestException('Organization not found')
    }

    // The saved list's persisted criteria ARE the audience. Resolving it here
    // rather than accepting inline filter fields is what makes the count
    // reproducible at send time from the id stored on the row.
    const filter =
      await this.voterFileFilterService.findByIdAndOrganizationSlug(
        input.voterFileFilterId,
        organizationSlug,
      )
    if (!filter) {
      throw new BadRequestException('Constituent list not found')
    }
    const filterInput: ContactsFilterResolutionInput = { ...filter }

    const optedOutPersonIds = await this.resolveOptOutScrub(organizationSlug)
    let excludedOptedOutCount = 0

    const audience = resolveFilterAudience(this.contactsService, {
      filterInput,
      organization,
      // Empty on purpose, with the scrub applied through `isEligible` below.
      // Handing the ids to people-api as an exclusion filter means those rows
      // never come back, so this route could only ever report how many people
      // the ORG has opted out — not how many THIS list lost, which is the
      // number quoted on the pay step. Matches the delivery layer, which has
      // to agree with this quote when it re-resolves at send time.
      excludePersonIds: new Set(),
      // After the cell-phone check and before dedupe/cap, so an opted-out
      // constituent neither claims a phone number nor spends a recipient.
      isEligible: (person) => {
        if (!optedOutPersonIds.has(person.id)) return true
        excludedOptedOutCount += 1
        return false
      },
      limitExceededMessage:
        `This list reaches over the ${MAX_AUDIENCE_RECIPIENTS} constituent ` +
        'limit — narrow the list and try again.',
    })

    // A generator's RETURN value carries the duplicate count, and
    // `for await...of` discards it — drive the iterator so the summary is
    // readable. See the helper's doc comment.
    let recipientCount = 0
    let next = await audience.next()
    while (!next.done) {
      recipientCount += 1
      next = await audience.next()
    }
    const { excludedDuplicatePhoneCount } = next.value

    if (recipientCount < MIN_SERVE_SMS_RECIPIENTS) {
      throw new BadRequestException(
        `This list reaches ${recipientCount} ` +
          `${recipientCount === 1 ? 'constituent' : 'constituents'} with a ` +
          `mobile number. A text send needs at least ` +
          `${MIN_SERVE_SMS_RECIPIENTS} — widen the list and try again.`,
      )
    }

    const outreach = await this.model.create({
      data: {
        // Serve scope: org only, never a campaign. The Outreach CHECK
        // enforces exactly one scoping path.
        campaignId: null,
        organizationSlug,
        outreachType: OutreachType.text,
        // The payment handler's CAS moves this to `pending`. Nothing else
        // may: the create schema refuses a client-sent status.
        status: OutreachStatus.pending_payment,
        name: input.name,
        message: input.message,
        imageUrl: input.imageUrl ?? null,
        // Date only. `date` (a UTC instant) and `scheduledLocalTime` stay
        // null: Serve sends at a fixed 11am local, so there is no chosen
        // time to store, and completion is derived as
        // addBusinessDays(scheduledLocalDate, 3) the way polls does it.
        scheduledLocalDate: input.scheduledLocalDate,
        voterFileFilterId: input.voterFileFilterId,
        // Server-derived, and the only number the purchase handler prices
        // from.
        textCount: recipientCount,
      },
      select: { id: true },
    })

    this.logger.info(
      {
        outreachId: outreach.id,
        organizationSlug,
        voterFileFilterId: input.voterFileFilterId,
        recipientCount,
        excludedOptedOutCount,
        excludedDuplicateCount: excludedDuplicatePhoneCount,
      },
      'Serve SMS draft created',
    )

    return {
      outreachId: outreach.id,
      recipientCount,
      // How many people THIS list lost to the scrub: they matched the filter,
      // had a cell phone, and were dropped for having opted out. Not the size
      // of the org's opt-out history — an org with 1,000 past opt-outs whose
      // list reaches 5 of them quotes 5.
      excludedOptedOutCount,
      excludedDuplicateCount: excludedDuplicatePhoneCount,
    }
  }

  /**
   * ENG-10800: a constituent who opted out of a past text in this org must
   * not land on the next one. Honoring an opt-out follows the message rather
   * than the sender, and Serve is explicitly a repeat-send product, so this
   * runs on every send rather than only on an expansion. It is also the gap
   * polls has today, which this build must not copy.
   *
   * Unlike `P2pPhoneListUploadService.resolveOptOutScrub`, an over-cap set is
   * NOT dropped. That cap exists because Win hands the ids to people-api as
   * an id filter; this route applies them in-process, so the vendor limit
   * does not apply and a large org gets a real scrub rather than none — the
   * compliance-sensitive degradation. Same posture as the delivery layer.
   * The only remaining truncation is the `LIMIT` inside
   * `findOptedOutPersonIds`, which is loud rather than silent.
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
          'may be incomplete for this draft',
      )
    }
    return new Set(optedOutIds)
  }
}
