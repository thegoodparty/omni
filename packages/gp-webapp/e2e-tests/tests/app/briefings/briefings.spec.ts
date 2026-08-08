import { expect, test, type Page } from '@playwright/test'
import { setupElectedOfficeUser } from '../../../src/helpers/organizations'
import { NavigationHelper } from '../../../src/helpers/navigation.helper'
import { WaitHelper } from '../../../src/helpers/wait.helper'

// End-to-end coverage for the Serve briefings detail page. A real briefing
// comes from a slow, non-deterministic, credit-spending agent run, so this
// seeds one through the preview/dev-only POST /v1/meetings/briefings/seed
// endpoint (gp-api, disabled on qa/prod). The seed writes a schema-shaped
// artifact to S3 and a MeetingBriefing row pointing at it, which is exactly
// what the read endpoint and the public PDF renderer both consume.
//
// Two flows are covered, and both are things unit tests structurally cannot
// reach: the share link must resolve for a logged-out recipient (a real
// cross-origin fetch), and the annotation anchor model round-trips a live DOM
// Selection through character offsets back onto repainted highlights (jsdom
// has no layout, no Selection geometry, and no CSS Custom Highlight API).

const MEETING_DATE = '2027-03-16'

const ITEM_ONE_SUMMARY =
  'Staff recommends approving the mixed-use overlay district for the ' +
  'downtown corridor before the spring construction window opens.'
const ITEM_TWO_SUMMARY =
  'Renewal of the three-year LED streetlight maintenance contract.'

// The passage the spec highlights, and the leaf node it lives in.
// AgendaItemCard puts data-anchor-json-path on the card wrapper AND on each
// inner field; anchorResolver's closest() walks to the INNERMOST one, so a
// selection inside the summary paragraph must anchor to the summary path,
// not to /items/0.
const HIGHLIGHT = 'mixed-use overlay district'
const SUMMARY_PATH = '/items/0/display/summary'
const HIGHLIGHT_START = ITEM_ONE_SUMMARY.indexOf(HIGHLIGHT)
const HIGHLIGHT_END = HIGHLIGHT_START + HIGHLIGHT.length

const CARD_PATH = '/items/1'

const PASSAGE_NOTE_BODY = 'Ask planning staff for the parking variance count.'
const CARD_NOTE_BODY = 'Confirm the contract renewal is on the consent agenda.'

// The runtime highlight name AnnotationsHighlightLayer registers note ranges
// under in CSS.highlights.
const NOTE_HIGHLIGHT_NAME = 'briefing-annotation-note'

const seedBody = () => ({
  meetingDate: MEETING_DATE,
  meetingName: 'Cheyenne City Council',
  meetingTime: '19:00',
  meetingTimezone: 'America/Denver',
  location: 'Council Chambers, 2101 O Neil Ave',
  officialName: 'Test Official',
  items: [
    {
      title: 'Downtown rezoning ordinance',
      summary: ITEM_ONE_SUMMARY,
      budgetImpactSummary: 'A one-time $1.25M appropriation from reserves.',
      sentimentSummary: 'Residents lean supportive of denser downtown housing.',
      talkingPoints: [
        { text: 'Housing supply follows zoning', why: 'Ties to the backlog' },
        { text: 'Phase the parking minimums', why: 'Softens the transition' },
        { text: 'Commit to a one-year review', why: 'Answers the skeptics' },
      ],
    },
    { title: 'Street lighting contract renewal', summary: ITEM_TWO_SUMMARY },
  ],
})

/**
 * Drive a real DOM Selection over `needle` inside the element carrying
 * `jsonPath`, then nudge the selection listeners the way a mouse drag would.
 * Returns the selected string so the caller can assert the browser agrees
 * about what got selected before trusting any offsets built from it.
 */
const selectSubstring = (page: Page, jsonPath: string, needle: string) =>
  page.evaluate(
    ({ jsonPath, needle }) => {
      const el = document.querySelector(`[data-anchor-json-path="${jsonPath}"]`)
      if (!el) return null
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node) {
        const index = node.textContent?.indexOf(needle) ?? -1
        if (index >= 0) {
          const range = document.createRange()
          range.setStart(node, index)
          range.setEnd(node, index + needle.length)
          const selection = window.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(range)
          document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
          return selection?.toString() ?? null
        }
        node = walker.nextNode()
      }
      return null
    },
    { jsonPath, needle },
  )

/**
 * The text each currently-painted note highlight covers.
 *
 * Notes are painted with the CSS Custom Highlight API, so the highlighted
 * words produce NO element of their own — the only DOM the layer inserts is
 * an icon-only marker span at the end of the range. Reading the registry back
 * is therefore the only way to assert WHICH words a stored annotation lands
 * on, which is the assertion that catches markup drift silently shifting
 * every saved offset.
 */
const paintedNoteText = (page: Page) =>
  page.evaluate((name) => {
    const registry = (
      CSS as unknown as {
        highlights?: Map<string, Iterable<Range>>
      }
    ).highlights
    const highlight = registry?.get(name)
    return highlight ? Array.from(highlight, (range) => range.toString()) : []
  }, NOTE_HIGHLIGHT_NAME)

const noteSheet = (page: Page) =>
  page.getByRole('dialog').filter({
    has: page.getByPlaceholder('Write a note, then tap Add Note...'),
  })

type CreatedAnnotation = { id: string }

/**
 * Escape every open Radix layer. Saving a note swaps the add-note sheet for
 * the notes cycler, so the surfaces stack — and while any of them is open the
 * shell is aria-hidden and pointer events don't reach the briefing cards.
 */
const closeAllLayers = async (page: Page) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    if ((await page.getByRole('dialog').count()) === 0) return
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
  }
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test.describe('Briefings', () => {
  test.beforeEach(async ({ page }) => {
    // HighlightToolbar positions itself from the selection rect (rect.top - 48,
    // clamped to the viewport), and the desktop bottom bar only renders at lg+.
    // Pin the viewport so neither depends on the runner's default.
    await page.setViewportSize({ width: 1280, height: 900 })
  })

  test('share link serves the PDF to a logged-out recipient', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000)

    const { client } = await setupElectedOfficeUser(page)
    await client.post('/v1/meetings/briefings/seed', seedBody())

    await page.goto(`/dashboard/briefings/${MEETING_DATE}`, {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)
    await WaitHelper.waitForPageReady(page)

    await expect(
      page.getByRole('heading', { name: 'Downtown rezoning ordinance' }),
    ).toBeVisible()

    // Two triggers exist: an icon button labelled "Share briefing" (lg:hidden)
    // and this desktop one. The pinned viewport is lg, so target the visible
    // one by its exact name.
    await page.getByRole('button', { name: 'Share', exact: true }).click()
    await expect(page.getByTestId('share-briefing-drawer')).toBeVisible()

    const shareUrl = (
      await page.getByTestId('share-briefing-url').innerText()
    ).trim()
    expect(shareUrl).toMatch(
      /^https?:\/\/.+\/api\/v1\/briefings\/[0-9a-f-]{36}$/,
    )

    // The regression this guards: the URL was built from the MARKETING origin
    // (goodparty.org), a separate deployment that does not proxy /api/v1/* to
    // gp-api, so every share link and QR scan 404'd. Assert the host is not
    // the marketing one — deliberately NOT equality with the page's own
    // origin, because APP_SHARE_BASE resolves to the Vercel branch alias while
    // the suite may be driving the deterministic PR alias or dev.goodparty.org.
    const shareHost = new URL(shareUrl).host
    expect(shareHost).not.toBe('goodparty.org')
    expect(shareHost).not.toBe('www.goodparty.org')

    // The single check that would have caught the outage: a recipient with no
    // session at all opens the link and gets the PDF.
    const anonymous = await browser.newContext()
    try {
      const response = await anonymous.request.get(shareUrl)
      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toContain('application/pdf')
      expect((await response.body()).byteLength).toBeGreaterThan(0)
    } finally {
      await anonymous.close()
    }
  })

  test('highlight a passage, add notes, and persist them across a reload', async ({
    page,
  }) => {
    test.setTimeout(240_000)

    const { client } = await setupElectedOfficeUser(page)
    await client.post('/v1/meetings/briefings/seed', seedBody())

    await page.goto(`/dashboard/briefings/${MEETING_DATE}`, {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)
    await WaitHelper.waitForPageReady(page)

    // 1. The seeded briefing renders and the leaf field is anchor-addressable.
    const summary = page.locator(`[data-anchor-json-path="${SUMMARY_PATH}"]`)
    await expect(summary).toHaveText(ITEM_ONE_SUMMARY)

    // 2. Selecting a known substring surfaces the toolbar. Assert it BEFORE
    // clicking through: useClearSelectionOnOpen deliberately drops the
    // selection the moment a sheet opens, so the toolbar is gone afterwards.
    expect(await selectSubstring(page, SUMMARY_PATH, HIGHLIGHT)).toBe(HIGHLIGHT)

    const toolbar = page.getByRole('toolbar', { name: 'Selection actions' })
    await expect(toolbar).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'Ask' })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'Report' })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'Dismiss' })).toBeVisible()

    // 3. Add Note opens the sheet; type the body and submit. Don't scroll
    // between selecting and clicking — the selection hooks dismiss on scroll.
    await toolbar.getByRole('button', { name: 'Add Note' }).click()
    const sheet = noteSheet(page)
    await expect(sheet).toBeVisible()
    await sheet
      .getByPlaceholder('Write a note, then tap Add Note...')
      .fill(PASSAGE_NOTE_BODY)

    const passageCreate = page.waitForResponse(
      (r) =>
        r.url().includes(`/v1/meetings/${MEETING_DATE}/briefing/annotations`) &&
        r.request().method() === 'POST',
    )
    await sheet.getByRole('button', { name: 'Add Note', exact: true }).click()
    const passageResponse = await passageCreate
    expect(
      passageResponse.status(),
      `create passage note: ${await passageResponse.text()}`,
    ).toBe(201)

    // 4. The wire assertion. Not "an anchor was sent" — the exact pointer and
    // the exact half-open offsets for the substring that was selected. If
    // markup drift shifts these, every stored annotation silently repaints
    // over the wrong words, and only this comparison notices.
    expect(passageResponse.request().postDataJSON()).toMatchObject({
      kind: 'note',
      anchor: {
        json_path: SUMMARY_PATH,
        start: HIGHLIGHT_START,
        end: HIGHLIGHT_END,
      },
    })
    const passageNote =
      (await passageResponse.json()) as Partial<CreatedAnnotation>
    expect(passageNote.id).toBeTruthy()
    const passageNoteId = passageNote.id!

    // On success AnnotationsScope hands off from the add-note sheet to the
    // notes cycler, so one Escape leaves a second layer open — and an open
    // Radix layer swallows the card click the next step depends on. Close
    // until nothing is left.
    await closeAllLayers(page)

    // 6. A card-level note: the second legal anchor shape in
    // AnnotationAnchorSchema (json_path set, both offsets null). The desktop
    // bottom bar's Notes button attaches to whichever card is active, so make
    // item 2 active first. Item 2 carries no annotations, so clicking it can't
    // be swallowed by the open-existing-annotation click handler.
    // ActiveCardScrollSpy re-picks the active card from scroll position once
    // its post-click lock expires, so clicking alone isn't enough — scroll the
    // card to the top first so the spy agrees, then wait for aria-current
    // rather than assuming the click stuck.
    const cardTwo = page.locator(`[data-anchor-json-path="${CARD_PATH}"]`)
    await cardTwo.evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await cardTwo.click()
    await expect(cardTwo).toHaveAttribute('aria-current', 'true')

    await page.getByRole('button', { name: 'Notes', exact: true }).click()

    const cardSheet = noteSheet(page)
    await expect(cardSheet).toBeVisible()
    await cardSheet
      .getByPlaceholder('Write a note, then tap Add Note...')
      .fill(CARD_NOTE_BODY)

    const cardCreate = page.waitForResponse(
      (r) =>
        r.url().includes(`/v1/meetings/${MEETING_DATE}/briefing/annotations`) &&
        r.request().method() === 'POST',
    )
    await cardSheet
      .getByRole('button', { name: 'Add Note', exact: true })
      .click()
    const cardResponse = await cardCreate
    expect(
      cardResponse.status(),
      `create card note: ${await cardResponse.text()}`,
    ).toBe(201)
    expect(cardResponse.request().postDataJSON()).toMatchObject({
      kind: 'note',
      anchor: { json_path: CARD_PATH, start: null, end: null },
    })

    await closeAllLayers(page)

    // 5. Persistence. Reload and assert the passage note repaints over the
    // exact words it was anchored to — the text, not a count. A highlight
    // that lands on the wrong words has to fail here.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)
    await WaitHelper.waitForPageReady(page)

    const marker = page.locator(
      `.briefing-note-marker[data-annotation-id="${passageNoteId}"]`,
    )
    await expect(marker).toHaveCount(1)
    await expect.poll(() => paintedNoteText(page)).toEqual([HIGHLIGHT])

    // 7. Delete the note. Clicking its marker opens the notes cycler, whose
    // footer carries the destructive action behind a confirm dialog.
    await marker.click()
    const notesSurface = page.getByRole('dialog').filter({
      hasText: PASSAGE_NOTE_BODY,
    })
    await expect(notesSurface).toBeVisible()

    await notesSurface.getByRole('button', { name: 'Delete note' }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click()

    await expect(page.getByText(PASSAGE_NOTE_BODY)).toHaveCount(0)
    await expect(marker).toHaveCount(0)
    await expect.poll(() => paintedNoteText(page)).toEqual([])
  })
})
