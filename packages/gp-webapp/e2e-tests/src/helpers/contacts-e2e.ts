import {
  type Locator,
  type Page,
  type Response,
  expect,
} from '@playwright/test'

/** Filters sheet uses Radix Dialog; match by CTA button and sheet slot. */
export function filtersSheet(page: Page, cta: RegExp): Locator {
  const btn = page.getByRole('button', { name: cta })
  return page
    .locator('[data-slot="sheet-content"]')
    .filter({ has: btn })
    .or(page.getByRole('dialog').filter({ has: btn }))
    .first()
}

/** Person overlay: narrow to the panel that shows Contact Information. */
export function personContactPanel(page: Page): Locator {
  const title = page.getByText('Contact Information', { exact: true })
  return page
    .locator('[data-slot="sheet-content"]')
    .filter({ has: title })
    .or(page.getByRole('dialog').filter({ has: title }))
    .first()
}

// The contacts list endpoint (GET /v1/contacts), not the per-person detail
// (/v1/contacts/:id), the stats (/v1/contacts/stats) or download
// (/v1/contacts/download) — those carry a trailing path segment.
const CONTACTS_LIST_PATH = /\/v1\/contacts$/

// Matches a contacts-list response, optionally pinned to one segment.
//
// `page=1` is always required. ContactsTableProvider runs TWO list queries: the
// one the table and the stat card render, and a page+1 prefetch it fires as
// soon as the current page reports hasNextPage. Both hit /v1/contacts, so an
// unqualified matcher resolves on whichever lands first — routinely the
// prefetch for the segment being navigated AWAY from, which is still in flight
// when the next action is taken. Every action these helpers wrap resets to page
// 1 (`selectSegment` / `searchContacts` pass `page: 1`), so requiring it
// excludes the prefetch without excluding anything a caller waits for.
//
// `segment` pins the wait to the query whose data the assertions will read.
// Without it the waiter is still satisfied by an in-flight page-1 request for
// the PREVIOUS segment, which resolves before the click has even re-keyed the
// query — see applyContactsQuery.
const isContactsListResponse =
  (segment?: string) =>
  (res: Response): boolean => {
    if (res.request().method() !== 'GET' || !res.ok()) return false
    const url = new URL(res.url())
    if (!CONTACTS_LIST_PATH.test(url.pathname)) return false
    if (url.searchParams.get('page') !== '1') return false
    return segment === undefined || url.searchParams.get('segment') === segment
  }

// The per-person detail endpoint (GET /v1/contacts/:id). The id segment has no
// further slash, so this excludes /v1/contacts/:id/issues and /activities; the
// negative lookahead also excludes the sibling single-segment endpoints
// /v1/contacts/stats and /v1/contacts/download, which would otherwise satisfy
// [^/?]+ and let detailLanded resolve on the wrong response.
const PERSON_DETAIL_RESPONSE = /\/v1\/contacts\/(?!stats|download)[^/?]+(\?|$)/

const isGetResponse = (regex: RegExp) => (res: Response) =>
  regex.test(res.url()) && res.request().method() === 'GET' && res.ok()

// Wait for the contacts table to leave its loading state and show a real row.
// ContactsTable swaps every cell for an `animate-pulse` skeleton while the
// contacts query is fetching, so the skeleton being gone (not just "some text
// present", which matches the previous segment's stale rows) is the signal that
// the displayed rows are the freshly-queried ones.
export async function waitForContactsTableReady(page: Page): Promise<void> {
  await expect(
    page.locator('.contacts-table-wrapper .animate-pulse'),
  ).toHaveCount(0, { timeout: 30_000 })
  // Zero results is a valid settled state once the skeleton clears. Don't wait
  // 30s for a first-row cell that will never exist (a misleading timeout) —
  // callers that require rows assert that for themselves.
  const rows = page.locator('table').first().locator('tbody tr')
  if ((await rows.count()) === 0) return
  await expect(rows.first().locator('td').first()).toHaveText(/.+/, {
    timeout: 30_000,
  })
}

// Run an action that re-queries the contacts table (apply/create/update a
// segment) and resolve only once the table shows the NEW data.
//
// Why: the action fires a fresh GET /v1/contacts and the table renders skeleton
// rows while it loads. Asserting before that settles reads the PREVIOUS
// segment's rows — the flaky `td.nth(5)` "--" failures. Gate on the list
// response landing AND the skeleton clearing so assertions see the new rows, not
// stale ones. The response waiter is armed before the action so a fast refetch
// can't resolve before we start listening.
//
// Pass `segment` whenever the caller knows which segment the action selects.
// Without it the two gates can BOTH be satisfied by the pre-action state: the
// waiter resolves on some other in-flight /v1/contacts response, and the
// skeleton check then passes because the router navigation hasn't committed
// yet, so the query hasn't re-keyed and no skeleton has gone up. The helper
// returns having observed the OLD segment throughout. Auto-retrying assertions
// absorb that; a one-shot read of rendered text (a stat card into a number)
// does not — it silently captures the previous segment's figure.
//
// With `segment`, the response can only land after the query re-keyed and
// started fetching, which is after the skeleton went up — so the skeleton
// clearing is genuinely the commit of the new data.
export async function applyContactsQuery(
  page: Page,
  action: () => Promise<void>,
  { segment }: { segment?: string } = {},
): Promise<void> {
  const responseLanded = page.waitForResponse(isContactsListResponse(segment), {
    timeout: 30_000,
  })
  await action()
  if (segment !== undefined) {
    // Exact param comparison rather than a URL regex, so `all` can't match a
    // segment named `all-something`. Fails fast and legibly when the click
    // didn't take, instead of as an opaque 30s response timeout.
    await page.waitForURL(
      (url) => url.searchParams.get('segment') === segment,
      {
        timeout: 30_000,
      },
    )
  }
  await responseLanded
  await waitForContactsTableReady(page)
}

// Open the person overlay for a table row and wait for the person detail to
// finish loading. The overlay renders its "Contact Information" title (which
// personContactPanel keys on) immediately but shows `animate-pulse` skeletons
// until GET /v1/contacts/:id resolves, so field labels like "Veteran Status"
// aren't in the DOM yet — asserting on them before the detail loads is the flaky
// "field not found". Arm the response waiter inside the loop so it always
// corresponds to the click that produced the visible panel (a first click can
// 200 but fail to open the panel; the retry's click is the one we want to wait
// on).
export async function openPersonPanel(
  page: Page,
  row: Locator,
  panel: Locator,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const detailLanded = page.waitForResponse(
      isGetResponse(PERSON_DETAIL_RESPONSE),
      {
        timeout: 30_000,
      },
    )
    await row.locator('td').first().click({ force: true })
    try {
      await expect(panel).toBeVisible({ timeout: 10_000 })
      await detailLanded
      break
    } catch {
      // Silence this attempt's waiter before re-arming: an unawaited
      // waitForResponse rejects with a timeout 30s later, which would surface as
      // an unhandled rejection after the test has moved on.
      detailLanded.catch(() => undefined)
      if (attempt === 2) await expect(panel).toBeVisible()
    }
  }
  await expect(panel.locator('.animate-pulse')).toHaveCount(0, {
    timeout: 30_000,
  })
}
