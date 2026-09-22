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
// cross-page phone dedupe and its count, the recipient cap, and a ceiling on
// how many pages one resolution may read.
//
// What deliberately did NOT: Peerly's requirement that state, city and zip
// all be present. That one is the vendor's rule, not the channel's — Peerly
// counts an incomplete address as a malformed lead, and a caller that needs
// it (or any other per-caller row requirement) has to pass it as isEligible.
// P2pPhoneListUploadService.hasGeoTargetableAddress is the worked example.
//
// Three circuit breakers guard this loop. They stop three different things
// and none of them substitutes for another, so read them together:
//
//   - the CAP bounds the output. Too many recipients for one send.
//   - the STALL guard bounds repetition. Consecutive full pages in which
//     people-api handed back no phone number this resolution had not already
//     seen — it is repeating itself, or ignoring the hasCellPhone it was
//     asked for. Deliberately NOT "pages that produced no recipient": a page
//     everyone on which isEligible rejects is legitimate filtering over fresh
//     records, and aborting there would kill a Peerly send the moment it hit
//     a page of voters with incomplete addresses.
//   - the SCAN ceiling bounds the input. Rejecting is progress by the stall
//     guard's measure, so a caller whose isEligible refuses nearly everyone
//     advances forever without either other breaker firing; without this it
//     would read the whole district one page at a time.
//
// Only the cap came from the Peerly loop. That loop's page ceiling assumed
// every page contributes a full page of recipients, which dedupe alone makes
// false near the cap; see SCAN_ALLOWANCE.
//
// A plain function rather than an injectable service, deliberately: callers
// hand it the ContactsService they already inject, so adding a second consumer
// needs no provider registration in any module.

// Mirrors outreachMaterialization.service.ts's paging shape (its
// SEGMENT_PAGE_SIZE is the sibling constant).
export const AUDIENCE_PAGE_SIZE = 1000
export const MAX_AUDIENCE_RECIPIENTS = 100_000

// How many rows the loop may read, as a multiple of the rows reaching
// maxRecipients would take if nothing were ever skipped. It has to be more
// than 1: every skip — a duplicate phone, a row people-api gave no phone for,
// an isEligible rejection — means one more row must be read to resolve the
// same recipient, so a filter at 5% phone duplication needs ~5% more pages
// than the naive count and a ceiling without headroom fails it for being
// popular. 2 is generous for both of today's callers (Peerly's skips are a
// few percent) while still refusing to walk a district for a filter that
// rejects more than half of what it reads.
const SCAN_ALLOWANCE = 2

// Consecutive full pages carrying no phone this resolution had not already
// seen. More than one, because a single such page is reachable legitimately
// when people-api's ordering clusters a household's shared numbers together;
// small, because the state it detects never recovers on its own.
const MAX_STALLED_PAGES = 3

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

  // The scan ceiling, in pages. `page > maxPages` permits exactly maxPages
  // fetches: at the defaults, page 201 is read and page 202 throws. The +1
  // is not slack on top of that — reaching the cap costs
  // ceil(maxRecipients * SCAN_ALLOWANCE / pageSize) pages and the recipient
  // that TRIPS the cap can only arrive on the page after those, so without
  // it a list resolving exactly maxRecipients people would 400.
  const maxPages = Math.ceil((maxRecipients * SCAN_ALLOWANCE) / pageSize) + 1

  // Spans every page: two voters sharing a cell phone must dedupe even
  // when people-api splits them across pages (ENG-10801). Keeping the
  // first person per number is deterministic given people-api's stable
  // ordering, and it fixes the inbound sweep's phone->person mapping,
  // which is ambiguous when a phone maps to more than one capture row.
  const seenPhones = new Set<string>()
  let excludedDuplicatePhoneCount = 0
  let resolvedCount = 0
  let stalledPages = 0

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

    // Measured before the eligibility gate and off the phone rather than the
    // recipient, because this asks what people-api returned, not what this
    // caller kept. An ineligible person is still a record the warehouse had
    // not shown us before.
    let sawUnseenPhone = false

    for (const person of people) {
      // hasCellPhone: true is forced above; cellPhone is nullable on the
      // Person contract regardless, so skip a row people-api can't
      // guarantee a phone for rather than resolving an unusable recipient.
      if (!hasCellPhone(person)) continue
      if (!seenPhones.has(person.cellPhone)) sawUnseenPhone = true
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

    // Throws rather than breaking, because breaking would hand back a
    // silently truncated audience, and a send that quietly reaches fewer
    // people than the filter promised is worse than one that fails loudly.
    // A short page has already ended the loop above, so a legitimate tail
    // cannot reach this.
    stalledPages = sawUnseenPhone ? 0 : stalledPages + 1
    if (stalledPages >= MAX_STALLED_PAGES) {
      throw new BadRequestException(
        `${MAX_STALLED_PAGES} consecutive full pages returned no phone ` +
          `number this resolution had not already seen — aborting`,
      )
    }

    page += 1
  }

  return { excludedDuplicatePhoneCount }
}
