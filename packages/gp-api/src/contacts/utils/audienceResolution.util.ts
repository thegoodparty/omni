import { BadRequestException } from '@nestjs/common'
import type { Person } from '@goodparty_org/contracts'
import { Organization } from '../../generated/prisma'
import {
  ContactsFilterResolutionInput,
  ContactsService,
} from '../services/contacts.service'

// Resolves a saved filter into an SMS-reachable audience, one page at a time.
//
// Lifted out of P2pPhoneListUploadService.buildPhoneList (ENG-10801 and its
// neighbours) so the Peerly phone-list upload and the shared text delivery
// layer resolve the same audience the same way while each writes its own CSV.
// Change it here only with both callers in mind.
//
// What came across from that loop: hasCellPhone forced on the filter,
// skipCount paging, the skip of a row people-api gives no phone for, the
// cross-page phone dedupe and its count, the per-page recipient cap, and the
// runaway-page guard.
//
// What deliberately did NOT: Peerly's requirement that state, city and zip
// all be present. That one is the vendor's rule, not the channel's — Peerly
// counts an incomplete address as a malformed lead, and a caller that needs
// it (or any other per-caller row requirement) has to pass it as isEligible.
// P2pPhoneListUploadService.hasGeoTargetableAddress is the worked example.
//
// What is NEW here, and so has no equivalent in that loop: the no-progress
// guard. The loop has three circuit breakers and they cover three different
// shapes of runaway, so read them together — the cap stops a filter that
// resolves too many people, the no-progress guard stops a full page that
// resolved nobody, and the page guard is the hard ceiling on fetches when
// pages do progress but only barely.
//
// A plain function rather than an injectable service, deliberately: callers
// hand it the ContactsService they already inject, so adding a second consumer
// needs no provider registration in any module.

// Mirrors outreachMaterialization.service.ts's paging shape (its
// SEGMENT_PAGE_SIZE is the sibling constant).
export const AUDIENCE_PAGE_SIZE = 1000
export const MAX_AUDIENCE_RECIPIENTS = 100_000

// people-api's Person carries a nullable cellPhone even when the filter forces
// hasCellPhone, so a resolved audience member is the narrowed shape: callers
// receive only people there is actually a number to text.
export type PhoneAudiencePerson = Person & { cellPhone: string }

export type AudienceResolutionSummary = {
  // People dropped because an earlier person in the same resolution already
  // claimed their phone number. Surfaced for the send's review/audit counts.
  excludedDuplicatePhoneCount: number
}

export type FilterAudienceOptions = {
  filterInput: ContactsFilterResolutionInput
  organization: Organization
  excludePersonIds: Set<string>
  pageSize?: number
  maxRecipients?: number
  // An extra per-caller eligibility test, applied after the phone check and
  // before dedupe/cap so a person this caller cannot use neither claims a
  // phone number nor spends a recipient.
  isEligible?: (person: PhoneAudiencePerson) => boolean
  // Kept caller-supplied so each channel's cap message speaks its own
  // vocabulary; the default is channel-neutral.
  limitExceededMessage?: string
}

const hasCellPhone = (person: Person): person is PhoneAudiencePerson =>
  Boolean(person.cellPhone)

/**
 * Yields every person a filter resolves to that this caller can text, then
 * returns the resolution's summary counts.
 *
 * `for await...of` cannot read a generator's return value, so callers that
 * need `excludedDuplicatePhoneCount` drive the iterator directly:
 *
 * ```ts
 * const audience = resolveFilterAudience(contactsService, options)
 * let next = await audience.next()
 * while (!next.done) {
 *   // next.value is one resolved person
 *   next = await audience.next()
 * }
 * const { excludedDuplicatePhoneCount } = next.value
 * ```
 */
export async function* resolveFilterAudience(
  contactsService: Pick<ContactsService, 'findContactsForFilter'>,
  options: FilterAudienceOptions,
): AsyncGenerator<PhoneAudiencePerson, AudienceResolutionSummary, void> {
  const {
    filterInput,
    organization,
    excludePersonIds,
    pageSize = AUDIENCE_PAGE_SIZE,
    maxRecipients = MAX_AUDIENCE_RECIPIENTS,
    isEligible,
    limitExceededMessage,
  } = options

  // The hard ceiling on fetches, for pages that do make progress but too
  // little of it to reach the cap. Reaching the cap itself costs
  // ceil(maxRecipients / pageSize) pages, and the recipient PAST the cap —
  // the one that trips it — can only arrive on the page after those, hence
  // the +1. `page > maxPages` then permits exactly maxPages fetches, which
  // is that allowance and not one more: at the defaults, page 101 is
  // fetched and page 102 throws. Tightening the comparison would 400 a list
  // that legitimately resolves exactly maxRecipients people.
  const maxPages = Math.ceil(maxRecipients / pageSize) + 1

  // Spans every page: two voters sharing a cell phone must dedupe even
  // when people-api splits them across pages (ENG-10801). Keeping the
  // first person per number is deterministic given people-api's stable
  // ordering, and it fixes the inbound sweep's phone->person mapping,
  // which is ambiguous when a phone maps to more than one capture row.
  const seenPhones = new Set<string>()
  let excludedDuplicatePhoneCount = 0
  let resolvedCount = 0

  let page = 1
  while (true) {
    if (page > maxPages) {
      throw new BadRequestException(
        `Pagination exceeded ${maxPages} pages — aborting`,
      )
    }
    const { people } = await contactsService.findContactsForFilter(
      // SMS reachability belongs to the channel, not the shared filter
      // resolution — force it here regardless of what the request asked.
      { ...filterInput, hasCellPhone: true },
      // Page off the rows returned, never a count: the count no longer
      // bounds the audience, and skipCount avoids a full-scan COUNT per page.
      { resultsPerPage: pageSize, page, skipCount: true },
      organization,
      excludePersonIds,
    )

    const resolvedBeforePage = resolvedCount

    for (const person of people) {
      // hasCellPhone: true is forced above; cellPhone is nullable on the
      // Person contract regardless, so skip a row people-api can't
      // guarantee a phone for rather than resolving an unusable recipient.
      if (!hasCellPhone(person)) continue
      if (isEligible && !isEligible(person)) continue
      if (seenPhones.has(person.cellPhone)) {
        excludedDuplicatePhoneCount += 1
        continue
      }
      seenPhones.add(person.cellPhone)
      resolvedCount += 1

      // The cap counts resolved recipients, not the raw filter match —
      // people skipped above for a missing phone or by isEligible don't use
      // up the budget. Checked here rather than at the end of the page so
      // the person past the cap is never emitted: a caller consuming this
      // generator acts on each person as it arrives, and handing it a whole
      // page beyond the limit before throwing would defeat the limit for
      // anything that writes as it reads.
      if (resolvedCount > maxRecipients) {
        throw new BadRequestException(
          limitExceededMessage ??
            `This filter matches over the ${maxRecipients} recipient ` +
              `limit — narrow the filter and try again.`,
        )
      }

      yield person
    }

    // A short (or empty) page is the last one — replaces the old
    // pagination.hasNextPage check, which came from the total count and
    // truncated the send whenever that count was floored.
    if (people.length < pageSize) break

    // A FULL page that resolved nobody means paging further is unbounded
    // work for an audience that is not growing: the cap can never fire
    // (resolvedCount is stuck) so only the page guard would stop it, after
    // maxPages full-size warehouse queries. Throws rather than breaking,
    // because breaking would silently hand back a truncated audience, and a
    // send that quietly reaches fewer people than the filter promised is
    // worse than one that fails loudly. It cannot fire on a legitimate tail
    // (a short page has already broken above).
    if (resolvedCount === resolvedBeforePage) {
      throw new BadRequestException(
        `A full page of ${pageSize} contacts resolved no new recipients ` +
          `— aborting`,
      )
    }

    page += 1
  }

  return { excludedDuplicatePhoneCount }
}
