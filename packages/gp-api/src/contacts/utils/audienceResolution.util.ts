import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common'
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
// Three circuit breakers guard this loop, plus a pre-flight and a deadline
// that bound it from outside. They stop five different things and none of them
// substitutes for another, so read them together:
//
//   - the PRE-FLIGHT bounds the cap cheaply, for a caller with a request
//     waiting. A filter whose matched count already exceeds maxRecipients
//     cannot be resolved inside the gateway's ~120s idle timeout, so it is
//     refused on page 1 rather than discovered ~219s in, after the client has
//     already been disconnected.
//   - the DEADLINE bounds the wall clock (timeBudgetMs). The pre-flight only
//     catches a filter over the CAP, and the cap sits far above what two
//     minutes of paging can reach: at the ~1.3-2.5s/page measured in prod,
//     120s buys 50-90 pages, so a filter matching 55,000-100,000 people used
//     to pass every guard here and then be killed in flight (INC-101: 82
//     pages, `statusCode: null` at 120,038ms, and the Peerly upload completed
//     45.9s after the client was gone, leaving a phone list nobody asked for
//     a second time). So once per page the projected finish time is compared
//     with the budget and a resolution that cannot land inside it is refused
//     at the earliest page that proves it. These two are the only guards whose
//     reason is the caller's deadline rather than the audience's shape — and so
//     the only ones a caller turns off, which a queue consumer should
//     (skipPreflightCap, and simply not passing timeBudgetMs).
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

// How long a resolution with a request waiting on it may spend reading pages.
//
// The gateway gives up on an idle request at ~120s. Out of that the handler
// also has to do its pre-resolution lookups (TCR compliance, the org, the
// opt-out scrub — a few seconds), assemble its CSV, hand it to the vendor and
// write its own rows (~3s for the 82,000-row upload in INC-101) and still get
// a response out. 90s leaves ~30s for all of that, which is why the number is
// not 120s.
//
// It is a budget, not a target: anything projected past it is refused in
// seconds with a message naming the matched count, instead of hanging for two
// minutes and then building a list the user never learns about. The trade is
// deliberate and it is visible — a filter that used to resolve in, say, 93s
// now gets a refusal. The fix that makes this constant unnecessary is taking
// the build off the request path (ENG-10801's follow-up); until then a fast,
// honest refusal beats a hang.
export const MAX_INTERACTIVE_RESOLUTION_MS = 90_000

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
  // How long this resolution may spend reading pages before it is refused.
  //
  // PASS IT WHENEVER THERE IS A REQUEST WAITING, and leave it undefined when
  // there is not. Both of today's HTTP callers pass
  // MAX_INTERACTIVE_RESOLUTION_MS; the SQS-driven delivery path passes nothing,
  // because its resolution genuinely completes however long it takes and a
  // refusal there would fail a send that is already paid for.
  //
  // Two checks come with it, and they fail differently on purpose:
  //   - the PROJECTION, once per page from page 2 on: matched count / pageSize
  //     gives the pages this filter needs, the pages already fetched give what
  //     one costs, and a projected finish past the budget is a
  //     BadRequestException naming the matched count. Client-correctable, so a
  //     400 — the route alerts ignore it, which is right: the user is told to
  //     narrow the filter and nothing is broken.
  //   - the HARD STOP, before fetching each page: elapsed past the budget is a
  //     ServiceUnavailableException, which the route alerts DO page on. By
  //     construction the projection should have refused first, so reaching it
  //     means upstream paging slowed down mid-resolution and we want to hear
  //     about it. Either way the handler stops while the client is still
  //     connected, so it can never upload work nobody is waiting for.
  //
  // The projection needs the matched count, which only page 1 asks for: a
  // caller passing skipPreflightCap with a budget keeps the hard stop alone.
  timeBudgetMs?: number
  // The deadline refusal's wording, so each channel speaks its own vocabulary
  // (the cap has limitExceededMessage for the same reason). Both counts are
  // measured rather than configured: affordableCount is what this filter's
  // observed page cost says fits inside the budget right now.
  budgetExceededMessage?: (counts: {
    matchedCount: number
    affordableCount: number
  }) => string
  // Skip the page-1 pre-flight cap, leaving only the in-loop cap.
  //
  // SET THIS WHEN THERE IS NO REQUEST WAITING, and only then. The pre-flight
  // trades precision for speed: it reads the MATCHED count, which is an upper
  // bound on the resolved one, so it refuses a filter matching more than
  // maxRecipients even when the skips would have brought it under. That trade
  // is free for an HTTP caller, because a resolution that large cannot finish
  // inside the gateway's ~120s idle timeout anyway — the refusal replaces a
  // hang, not a success.
  //
  // On a queue consumer it is not free, it is a regression: there is no
  // deadline, so the long resolution genuinely completes, and refusing it
  // turns a send that works today into a `BadRequestException`. Worse, the
  // delivery path reads a 4xx as "the data is wrong, a retry reads the same
  // rows" and marks the outreach permanently `failed` on a row that is
  // already PAID.
  //
  // The gap is not a corner case there either: outreachTextDelivery scrubs
  // opt-outs in-process rather than as a query filter (so the official sees
  // how many THIS audience lost), which means matched-minus-resolved is
  // routinely the size of the org's whole opt-out set.
  skipPreflightCap?: boolean
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
    timeBudgetMs,
    budgetExceededMessage,
    skipPreflightCap = false,
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

  // The deadline's two measurements. Page 1 is timed but kept OUT of the
  // per-page average: it carries the parallel COUNT the pre-flight needs, so
  // it is the slowest page of the resolution and projecting 80 more pages from
  // it would refuse filters that finish comfortably.
  const startedAt = Date.now()
  let pagingMsAfterPage1 = 0
  let matchedCount: number | null = null

  let page = 1
  while (true) {
    if (page > maxPages) {
      throw new BadRequestException(
        `Pagination exceeded ${maxPages} pages — aborting`,
      )
    }

    // THE HARD STOP. The projection below should have refused long before
    // this, so getting here means paging slowed down after this resolution
    // started. Stop while the client is still connected: the alternative is
    // the gateway hanging up at ~120s and the handler carrying on to finish
    // work that nobody will be told about.
    if (timeBudgetMs !== undefined && Date.now() - startedAt > timeBudgetMs) {
      throw new ServiceUnavailableException(
        'Resolving this audience ran out of time before it finished — ' +
          'nothing was created. Try again, or narrow the filter.',
      )
    }

    const pageStartedAt = Date.now()
    const { people, pagination } = await contactsService.findContactsForFilter(
      // SMS reachability belongs to the channel, not the shared filter
      // resolution — force it here regardless of what the request asked.
      { ...filterInput, hasCellPhone: true },
      // Page off the rows returned, never a count: the count no longer
      // bounds the audience, and skipCount avoids a full-scan COUNT per page.
      //
      // Page 1 is the exception, and it is nearly free. The count is asked for
      // on a page that is fetched anyway, and the Databricks path runs the
      // COUNT in PARALLEL with the page query, so this adds no round trip and
      // at worst the amount by which the COUNT outlasts the page fetch (both
      // are low single-digit seconds in prod). Every later page keeps
      // skipCount, so it is one COUNT per resolution, not one per page.
      //
      // Not asked for at all when the pre-flight is off, since nothing would
      // read it: a caller that opted out should not pay for the COUNT either.
      {
        resultsPerPage: pageSize,
        page,
        skipCount: page > 1 || skipPreflightCap,
      },
      organization,
      excludePersonIds,
    )
    if (page === 1) {
      // Only page 1 is asked for the count, and only when the pre-flight is on.
      matchedCount = skipPreflightCap ? null : pagination.totalResults
    } else {
      pagingMsAfterPage1 += Date.now() - pageStartedAt
    }

    // THE CAP, CHECKED BEFORE THE WORK INSTEAD OF DURING IT — for a caller
    // with a request waiting. See skipPreflightCap for who opts out and why.
    //
    // The in-loop cap below is correct but unreachable on an HTTP path: it can
    // only throw once maxRecipients recipients have been resolved, which at the
    // phone-list defaults means page 101. Measured in prod at ~2.17s/page that
    // is ~219s, and the gateway gives up at ~120s — so an over-cap filter was
    // killed in flight at 120s (logging `statusCode: null`, which is what pages
    // us) and the handler then spent another ~99s paging toward a 400 no client
    // was still there to receive. Ten of those in the 30 days to 2026-09-27.
    //
    // totalResults is an UPPER BOUND on the resolved count: every later step
    // (the missing-phone skip, isEligible, the phone dedupe) only ever removes
    // people. So `totalResults > maxRecipients` does not prove the resolution
    // would have tripped the cap — but it does prove it must read more than
    // maxRecipients/pageSize pages before it could finish either way, which at
    // any observed page latency is past the gateway's patience. Nothing an HTTP
    // caller completes today is refused here; what changes is that the answer
    // arrives in about a second instead of never.
    if (
      !skipPreflightCap &&
      page === 1 &&
      pagination.totalResults > maxRecipients
    ) {
      throw new BadRequestException(
        limitExceededMessage ??
          `This filter matches over the ${maxRecipients} recipient ` +
            `limit — narrow the filter and try again.`,
      )
    }

    // THE DEADLINE, PROJECTED. The resolution reads a page per 1000 matched
    // rows whatever the later skips do (skips remove recipients, not reads),
    // so pages-still-to-read times what a page has actually cost this
    // resolution is how long it has left. Refuse at the first page that proves
    // it cannot land inside the budget — not at page 1, whose COUNT makes it
    // unrepresentative, and not at the end, which is the hang this replaces.
    if (
      timeBudgetMs !== undefined &&
      matchedCount !== null &&
      page > 1 &&
      people.length >= pageSize
    ) {
      const avgPageMs = pagingMsAfterPage1 / (page - 1)
      const pagesNeeded = Math.ceil(matchedCount / pageSize)
      const elapsedMs = Date.now() - startedAt
      const projectedMs =
        elapsedMs + Math.max(0, pagesNeeded - page) * avgPageMs
      if (projectedMs > timeBudgetMs) {
        // What the measured page cost says does fit, reported to the person so
        // "narrow the filter" is a number rather than an instruction to guess.
        // It has to be a size that SURVIVES THIS SAME CHECK on the retry, so
        // the divisor is the budget still unspent, not all of it: a retry pays
        // the slow first page and these same pages over again before it can be
        // judged. That makes the number a little pessimistic (it does not
        // credit back the pages already read), which is the right direction —
        // naming a count that gets refused a second time is the failure this
        // message exists to avoid.
        const affordableCount =
          Math.max(
            1,
            Math.floor(
              Math.max(0, timeBudgetMs - elapsedMs) / Math.max(avgPageMs, 1),
            ),
          ) * pageSize
        throw new BadRequestException(
          budgetExceededMessage?.({ matchedCount, affordableCount }) ??
            `This filter matches ${matchedCount} people — more than can be ` +
              `resolved while you wait (about ${affordableCount} right now). ` +
              `Narrow the filter and try again.`,
        )
      }
    }

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
