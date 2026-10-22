import { BadRequestException, Injectable } from '@nestjs/common'
import {
  findCivicPanelJoinLine,
  findCivicPanelLeaveLine,
  FOLLOW_UP_BUSINESS_DAYS,
  isCivicPanelOnlyList,
  MIN_TEXTS_PER_ROUND,
  ROUND_TWO_DRAW_LEAD_BUSINESS_DAYS,
  ServeSmsCreateRequest,
  ServeSmsCreateResponse,
} from '@goodparty_org/contracts'
import { addBusinessDays, addDays, format, isWeekend, parseISO } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { MAX_RESOLVED_ID_SET_SIZE } from '@/contactInteraction/services/activityConditionResolution.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import {
  ContactsFilterResolutionInput,
  ContactsService,
} from '@/contacts/services/contacts.service'
import {
  MAX_AUDIENCE_RECIPIENTS,
  MAX_INTERACTIVE_RESOLUTION_MS,
  resolveFilterAudience,
} from '@/contacts/utils/audienceResolution.util'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { ISO_DATE_ONLY_RE } from '@/shared/util/date.util'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import {
  resolveProposalLink,
  type ProposalOutreachLink,
} from '@/priorities/util/proposalLink.util'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import type { ProposalLink } from '@goodparty_org/contracts'
import { roundTwoExclusions } from '@/priorities/util/roundTwoExclusions.util'
import { createUnderProposalKey } from '../util/createUnderProposalKey.util'
import { assertServeSmsLockedLines } from '../util/serveSmsLockedLines.util'
import {
  ElectedOffice,
  Organization,
  OutreachStatus,
  OutreachType,
  Prisma,
} from '../../generated/prisma'
import { OutreachReportBackService } from './outreachReportBack.service'

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
 * characters and `SMS_COMPOSED_MAX_LENGTH` is 2000, so the poll pattern of
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

// A follow-up is sized to at most this share of the people left after the
// first half, so a draw that finds some of them gone still fills it.
export const FOLLOW_UP_POOL_SHARE = 0.9

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

// The earliest day the check above accepts, as yyyy-MM-dd: three business
// days out.
export const earliestServeSmsSendDate = (now: Date = new Date()): string =>
  format(
    addBusinessDays(referenceToday(now), MIN_SERVE_SMS_LEAD_BUSINESS_DAYS + 1),
    'yyyy-MM-dd',
  )

// The latest send date whose round 2 is due to be drawn today: the last day
// a new send for that date would still be accepted above
// (ROUND_TWO_DRAW_LEAD_BUSINESS_DAYS is MIN_SERVE_SMS_LEAD_BUSINESS_DAYS + 1),
// so staff get the same lead as on any other Serve text.
export const roundTwoDrawCutoff = (now: Date): string =>
  format(
    addBusinessDays(referenceToday(now), ROUND_TWO_DRAW_LEAD_BUSINESS_DAYS),
    'yyyy-MM-dd',
  )

@Injectable()
export class OutreachServeSmsCreateService extends createPrismaBase(
  MODELS.Outreach,
) {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly organizationsService: OrganizationsService,
    private readonly voterFileFilterService: VoterFileFilterService,
    private readonly contactInteractionTextService: ContactInteractionTextService,
    private readonly reportBack: OutreachReportBackService,
  ) {
    super()
  }

  // A report back answers one of the office's own priority texts whose
  // replies are in. It is linked through that send, never to the priority
  // or a check itself, so it is never read as another ask; and it never asks
  // anyone to join the panel.
  async assertReportBackTarget(
    electedOffice: Pick<ElectedOffice, 'id' | 'organizationSlug'>,
    outreachId: number,
    draft: { message: string; link: ProposalOutreachLink },
  ): Promise<void> {
    if (
      draft.link.priorityId !== undefined ||
      draft.link.priorityStepId !== undefined
    ) {
      throw new BadRequestException(
        'A report back is linked through the text it reports on',
      )
    }
    if (findCivicPanelJoinLine(draft.message) !== null) {
      throw new BadRequestException(
        "A report back doesn't ask people to join your civic panel. Remove that line and try again.",
      )
    }
    const target = await this.model.findFirst({
      where: {
        id: outreachId,
        ...this.reportBack.repliesInWhere(
          electedOffice.organizationSlug,
          electedOffice.id,
        ),
      },
      select: { priorityId: true },
    })
    if (!target?.priorityId) {
      throw new BadRequestException(
        "That text can't be reported back on yet. Wait until its replies are in.",
      )
    }
    // One report back each time the priority's read changes: a paid one
    // closes it until then. Unpaid drafts are left alone, since re-entering
    // the flow makes a fresh draft by design; the checkout refuses a second
    // once one is paid.
    if (
      await this.reportBack.sentReportBack(
        electedOffice.organizationSlug,
        target.priorityId,
      )
    ) {
      throw new BadRequestException(
        "You already told people what you heard. We'll offer it again when what you've heard changes.",
      )
    }
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
  resolveProposalLink(link: ProposalLink, electedOfficeId: string) {
    return resolveProposalLink(this.client, link, electedOfficeId)
  }

  async createDraft(
    organizationSlug: string,
    input: ServeSmsCreateRequest,
    link: ProposalOutreachLink = {},
  ): Promise<ServeSmsCreateResponse> {
    // Cheapest rejection first: no point resolving an audience for a date
    // fulfilment cannot work.
    assertServeSmsSendDateAllowed(input.scheduledLocalDate)
    assertServeSmsLockedLines(input.message)

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

    // The LEAVE line belongs to a send that reaches panel members alone, and
    // a send never carries both civic panel lines: one asks people on, the
    // other offers members a way off.
    const asksToJoinCivicPanel = findCivicPanelJoinLine(input.message) !== null
    const offersCivicPanelLeave =
      findCivicPanelLeaveLine(input.message) !== null
    if (asksToJoinCivicPanel && offersCivicPanelLeave) {
      throw new BadRequestException(
        "A text can't ask people to join your civic panel and offer a way to leave it. Remove one of those lines and try again.",
      )
    }
    if (offersCivicPanelLeave && !isCivicPanelOnlyList(filter)) {
      throw new BadRequestException(
        'Only a text to your civic panel can offer a way to leave it. Remove that line and try again.',
      )
    }

    const {
      recipientCount,
      excludedOptedOutCount,
      excludedDuplicatePhoneCount,
    } = await this.resolveListAudienceCount(
      organization,
      filterInput,
      organizationSlug,
    )

    if (recipientCount < MIN_SERVE_SMS_RECIPIENTS) {
      throw new BadRequestException(
        `This list reaches ${recipientCount} ` +
          `${recipientCount === 1 ? 'constituent' : 'constituents'} with a ` +
          `mobile number. A text send needs at least ` +
          `${MIN_SERVE_SMS_RECIPIENTS} — widen the list and try again.`,
      )
    }

    const data = {
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
      // Read off the message, never a request flag, so the stored text and
      // whether the ingest honors JOIN cannot disagree.
      asksToJoinCivicPanel,
      offersCivicPanelLeave,
      imageUrl: input.imageUrl,
      // Date only. `date` (a UTC instant) and `scheduledLocalTime` stay
      // null: Serve sends at a fixed 11am local, so there is no chosen
      // time to store, and completion is derived as
      // addBusinessDays(scheduledLocalDate, 3) the way polls does it.
      scheduledLocalDate: input.scheduledLocalDate,
      voterFileFilterId: input.voterFileFilterId,
      reportBackForOutreachId: input.reportBackForOutreachId ?? null,
      // Server-derived, and the only number the purchase handler prices
      // from.
      textCount: recipientCount,
      ...link,
    } satisfies Prisma.OutreachUncheckedCreateInput
    const followUp =
      input.roundTwoSize === undefined
        ? null
        : await this.resolveFollowUp(
            organization,
            filter,
            input,
            link,
            recipientCount,
          )
    // The follow-up goes out on a copy of the list's criteria holding a
    // sample still to be drawn, which is what marks it as round 2 and keeps
    // it from reaching anyone before the draw. It is written in the same
    // transaction as the first send it belongs to, so a create that fails
    // leaves neither behind, and it carries no proposal key: the first send
    // holds the card's.
    const insert = async (tx: Prisma.TransactionClient) => {
      const created = await tx.outreach.create({
        data,
        select: { id: true },
      })
      if (followUp) {
        await tx.outreach.create({
          data: {
            ...data,
            proposalKey: null,
            roundOneOutreachId: created.id,
            scheduledLocalDate: followUp.scheduledLocalDate,
            textCount: followUp.recipientCount,
            voterFileFilterId: (
              await this.voterFileFilterService.createUndrawnSampleOf(
                tx,
                filter,
                followUp.recipientCount,
                `${filter.name ?? input.name}, follow-up`,
              )
            ).id,
          },
          select: { id: true },
        })
      }
      return created
    }
    const outreach =
      link.proposalKey !== undefined
        ? await createUnderProposalKey(
            this.client,
            {
              proposalKey: link.proposalKey,
              organizationSlug,
              outreachType: OutreachType.text,
            },
            insert,
            async (id) => ({ id }),
          )
        : followUp
          ? await this.client.$transaction(insert)
          : await this.model.create({ data, select: { id: true } })
    const followUpRow = followUp
      ? await this.model.findUnique({
          where: { roundOneOutreachId: outreach.id },
          select: { id: true, textCount: true, scheduledLocalDate: true },
        })
      : null

    // One payable report back per send: a new draft supersedes the unpaid
    // ones before it, so a stale draft left open in another tab can no
    // longer reach checkout. The same card pressed twice already lands on
    // one draft through its proposal key.
    if (input.reportBackForOutreachId !== undefined) {
      await this.model.updateMany({
        where: {
          reportBackForOutreachId: input.reportBackForOutreachId,
          status: OutreachStatus.pending_payment,
          id: { not: outreach.id },
        },
        data: {
          status: OutreachStatus.canceled,
          canceledAt: new Date(),
          canceledBy: 'superseded_report_back',
        },
      })
    }

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
      ...(followUpRow?.textCount != null &&
        followUpRow.scheduledLocalDate !== null && {
          followUp: {
            outreachId: followUpRow.id,
            recipientCount: followUpRow.textCount,
            scheduledLocalDate: followUpRow.scheduledLocalDate,
          },
        }),
    }
  }

  // A priority text's follow-up: paid for now at `roundTwoSize`, or at most
  // FOLLOW_UP_POOL_SHARE of what the pool holds past this send if fewer, and
  // drawn on the last day staff can take it. The share leaves a buffer for
  // people who opt out or are reached some other way before the draw, so the
  // draw rarely finds fewer people than were paid for. The pool is the list's whole criteria (never its sample) on
  // cell phones, less everyone the priority's other sends reached, everyone
  // opted out, and the people this send goes to. Too few left for a text of
  // its own is no follow-up, and the purchase is this send alone.
  private async resolveFollowUp(
    organization: Organization,
    filter: ContactsFilterResolutionInput,
    input: ServeSmsCreateRequest,
    link: ProposalOutreachLink,
    roundOneCount: number,
  ): Promise<{ recipientCount: number; scheduledLocalDate: string } | null> {
    if (link.priorityId === undefined) {
      throw new BadRequestException('A follow-up text belongs to a priority')
    }
    if (input.reportBackForOutreachId !== undefined) {
      throw new BadRequestException("A report back can't have a follow-up")
    }
    const exclude = await roundTwoExclusions(
      this.client,
      organization.slug,
      link.priorityId,
      [...(await this.resolveOptOutScrub(organization.slug))],
    )
    const pool = await this.contactsService.countWithin(
      organization,
      { ...filter, sampleSize: null, hasCellPhone: true },
      exclude,
    )
    const recipientCount = Math.min(
      input.roundTwoSize ?? 0,
      Math.floor((pool - roundOneCount) * FOLLOW_UP_POOL_SHARE),
    )
    if (recipientCount < MIN_TEXTS_PER_ROUND) return null
    return {
      recipientCount,
      scheduledLocalDate: format(
        addBusinessDays(
          parseISO(input.scheduledLocalDate),
          FOLLOW_UP_BUSINESS_DAYS,
        ),
        'yyyy-MM-dd',
      ),
    }
  }

  /**
   * How many people a saved list reaches once the opt-out scrub and the phone
   * dedupe have run. Shared with the Serve poll create so a poll to a list is
   * counted and billed exactly as a text to it.
   */
  async resolveListAudienceCount(
    organization: Organization,
    filterInput: ContactsFilterResolutionInput,
    organizationSlug: string,
  ): Promise<{
    recipientCount: number
    excludedOptedOutCount: number
    excludedDuplicatePhoneCount: number
  }> {
    const optedOutPersonIds = await this.resolveOptOutScrub(organizationSlug)
    let excludedOptedOutCount = 0

    const audience = resolveFilterAudience(this.contactsService, {
      filterInput,
      organization,
      dataset: await this.contactsService.resolvePeopleDataset(organization),
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
      // Same clock as the phone-list upload, and for the same reason: this runs
      // on a request, nothing has been paid for yet, and a draft the gateway
      // killed at ~120s is a pay step the official never reaches. A refusal
      // naming the count is something they can act on.
      timeBudgetMs: MAX_INTERACTIVE_RESOLUTION_MS,
      budgetExceededMessage: ({ matchedCount, affordableCount }) =>
        `This list reaches ${matchedCount} constituents — too many to quote ` +
        `while you wait (about ${affordableCount} right now). Narrow the list ` +
        `and try again.`,
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

    return {
      recipientCount,
      excludedOptedOutCount,
      excludedDuplicatePhoneCount,
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
  async resolveOptOutScrub(organizationSlug: string): Promise<Set<string>> {
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
