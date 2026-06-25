import { expect, test } from '@playwright/test'
import { setupElectedOfficeUser } from '../../../src/helpers/organizations'
import { NavigationHelper } from '../../../src/helpers/navigation.helper'
import { WaitHelper } from '../../../src/helpers/wait.helper'

// End-to-end coverage for the Serve "Community Issues" feature. Issues are
// normally produced by an async AI agent run (slow, non-deterministic, spends
// credits), so this seeds deterministic data through the preview/dev-only
// POST /v1/community-issues/seed endpoint (gp-api, disabled on qa/prod). The
// seed runs the real upsertFromArtifact write path, so the rows match what the
// pipeline produces. The suite runs against the per-PR full-stack preview (and
// dev post-merge), where that endpoint is enabled.

const OVERVIEW_PHRASE = 'Rents in the downtown corridor doubled since 2019.'
const MEETING_DATE = '2026-07-01'

const source = (id: string, name: string) => ({
  id,
  name,
  retrieved_at: '2026-06-01',
  retrieved_text_or_snapshot: 'snapshot',
  source_type: 'news' as const,
})

const seedBody = () => ({
  issues: [
    {
      list: 'top_community' as const,
      category: 'housing_and_development',
      priority: 'high' as const,
      title: 'Housing affordability',
      summary: 'Rents are rising faster than wages.',
      rank: 1,
      detail: {
        sources: [source('s1', 'City Herald'), source('s2', 'Housing Board')],
        overview: { source_ids: ['s1'], summary: OVERVIEW_PHRASE },
        history: {
          source_ids: ['s2'],
          summary: 'The squeeze began after the 2018 rezoning.',
        },
        quotes: {
          items: [
            {
              source_id: 's1',
              text: 'I had to take a second job to keep my apartment.',
              attribution: 'Maria, Ward 1 resident',
            },
          ],
        },
        research: {
          source_ids: ['s2'],
          summary: 'Median rent rose 41% over five years.',
        },
      },
      relatedBriefing: {
        meetingDate: MEETING_DATE,
        briefingItemId: 'item-housing',
        content: 'Council discussed a rent-stabilization proposal.',
      },
    },
    {
      list: 'top_community' as const,
      category: 'public_safety',
      priority: 'medium' as const,
      title: 'Street lighting',
      summary: 'Several intersections stay dark at night.',
      rank: 2,
      detail: {
        sources: [source('s1', 'City Herald')],
        overview: { source_ids: ['s1'], summary: 'Outages near the school.' },
      },
    },
    {
      list: 'trending' as const,
      category: 'quality_of_life',
      priority: 'low' as const,
      title: 'Park cleanup at Riverside',
      summary: 'Litter is piling up along the trail.',
      rank: 1,
      detail: {
        sources: [source('s1', 'City Herald')],
        overview: { source_ids: ['s1'], summary: 'Volunteers want a cleanup.' },
      },
    },
  ],
})

test('Community Issues: lists, prioritize, AI chat, next steps', async ({
  page,
}) => {
  test.setTimeout(180_000)

  const { client } = await setupElectedOfficeUser(page)

  const { data: seeded } = await client.post<{
    issues: { id: string; list: string; rank: number | null; title: string }[]
  }>('/v1/community-issues/seed', seedBody())
  const housingId = seeded.issues.find(
    (i) => i.title === 'Housing affordability',
  )?.id
  expect(housingId).toBeTruthy()

  // --- Scenario 1: the two lists ---------------------------------------------
  await page.goto('/dashboard/community-issues', {
    waitUntil: 'domcontentloaded',
  })
  await NavigationHelper.dismissOverlays(page)
  await WaitHelper.waitForPageReady(page)

  // Trending card: the trending issue + a "View all" link to /trending.
  await expect(
    page.getByRole('heading', { name: 'Trending community issues' }),
  ).toBeVisible()
  await expect(page.getByText('Trending now')).toBeVisible()
  const trendingRow = page.getByRole('link', {
    name: /Park cleanup at Riverside/,
  })
  await expect(trendingRow).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'View all', exact: true }),
  ).toHaveAttribute('href', '/dashboard/community-issues/trending')

  // Top card: ranked issues numbered in rank order + a "View all issues" link.
  await expect(
    page.getByRole('heading', { name: 'Top community issues' }),
  ).toBeVisible()
  const housingCard = page.getByRole('link', { name: /Housing affordability/ })
  const streetCard = page.getByRole('link', { name: /Street lighting/ })
  await expect(housingCard).toContainText('1')
  await expect(streetCard).toContainText('2')
  const housingY = (await housingCard.boundingBox())?.y ?? 0
  const streetY = (await streetCard.boundingBox())?.y ?? 0
  expect(housingY).toBeLessThan(streetY)
  await expect(
    page.getByRole('link', { name: 'View all issues' }),
  ).toHaveAttribute('href', '/dashboard/community-issues/all')

  // Full lists render at /all and /trending.
  await page.getByRole('link', { name: 'View all issues' }).click()
  await page.waitForURL('**/dashboard/community-issues/all')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Top community issues',
  )
  await expect(
    page.getByRole('link', { name: /Housing affordability/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: /Street lighting/ }),
  ).toBeVisible()

  await page.goto('/dashboard/community-issues/trending', {
    waitUntil: 'domcontentloaded',
  })
  await WaitHelper.waitForPageReady(page)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Trending community issues',
  )
  await expect(
    page.getByRole('link', { name: /Park cleanup at Riverside/ }),
  ).toBeVisible()

  // --- Scenario 2: prioritization (+ the detail-bar must not change height) --
  await page.goto(`/dashboard/community-issues/${housingId}`, {
    waitUntil: 'domcontentloaded',
  })
  await NavigationHelper.dismissOverlays(page)
  await WaitHelper.waitForPageReady(page)

  const heading = page.getByRole('heading', { name: 'Issue Details' })
  await expect(heading).toBeVisible()
  const detailBar = heading.locator('xpath=../..')
  const addButton = page.getByRole('button', { name: 'Add to my priorities' })
  await expect(addButton).toBeVisible()
  await expect(page.getByText('My priority')).toBeHidden()
  const barHeightBefore = (await detailBar.boundingBox())?.height ?? 0

  const prioritizeResponse = page.waitForResponse(
    (r) =>
      r.url().includes(`/v1/community-issues/${housingId}/prioritize`) &&
      r.request().method() === 'POST',
  )
  await addButton.click()
  const prioritizeRes = await prioritizeResponse
  expect(prioritizeRes.ok()).toBeTruthy()

  // Header flips to the confirmation + pill; re-adding is no longer offered.
  await expect(page.getByRole('button', { name: 'Added' })).toBeVisible()
  await expect(page.getByText('My priority')).toBeVisible()
  await expect(addButton).toHaveCount(0)

  // The detail bar must not jump height (the prior layout-shift bug).
  const barHeightAfter = (await detailBar.boundingBox())?.height ?? 0
  expect(Math.abs(barHeightAfter - barHeightBefore)).toBeLessThanOrEqual(1)

  // Server-side confirmation: the issue now reads prioritized.
  const { data: detailAfter } = await client.get<{ prioritized: boolean }>(
    `/v1/community-issues/${housingId}`,
  )
  expect(detailAfter.prioritized).toBe(true)

  // --- Scenario 3: AI chat ("leaving AI comments") ---------------------------
  // Footer chat bar opens the Chief of Staff surface.
  await page.getByRole('button', { name: /how can I help/i }).click()
  await expect(page.getByText('Always on, working on your week')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Always on, working on your week')).toBeHidden()

  // Highlight a passage -> "Ask AI" popover -> a conversation is created with a
  // community_issue anchor carrying the highlighted text. We assert the create
  // call only (not the streamed reply, which needs live LLM credits).
  const selectedText = await page.evaluate((phrase) => {
    const p = Array.from(document.querySelectorAll('p')).find((el) =>
      el.textContent?.includes(phrase),
    )
    if (!p) return null
    const range = document.createRange()
    range.selectNodeContents(p)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return sel?.toString().trim() ?? null
  }, OVERVIEW_PHRASE)
  expect(selectedText).toBe(OVERVIEW_PHRASE)

  const askAi = page.getByRole('button', { name: 'Ask AI' })
  await expect(askAi).toBeVisible()
  const chatCreate = page.waitForResponse(
    (r) => r.url().endsWith('/v1/chats') && r.request().method() === 'POST',
  )
  await askAi.click()
  const chatRes = await chatCreate
  expect(chatRes.ok()).toBeTruthy()
  const chatPayload = chatRes.request().postDataJSON() as {
    scope: string
    anchor: {
      resourceType: string
      resourceId: string
      url: string
      snapshot: { highlightedText?: string }
    }
  }
  expect(chatPayload.scope).toBe('chief_of_staff')
  expect(chatPayload.anchor.resourceType).toBe('community_issue')
  expect(chatPayload.anchor.resourceId).toBe(housingId)
  expect(chatPayload.anchor.url).toContain(
    `/dashboard/community-issues/${housingId}`,
  )
  expect(chatPayload.anchor.snapshot.highlightedText).toBe(OVERVIEW_PHRASE)
  await page.keyboard.press('Escape')

  // --- Scenario 4: next steps ------------------------------------------------
  await page.goto(`/dashboard/community-issues/${housingId}`, {
    waitUntil: 'domcontentloaded',
  })
  await WaitHelper.waitForPageReady(page)

  const pollLink = page.getByRole('link', { name: 'Run a poll on this issue' })
  // The ?issue= param was intentionally dropped — assert the bare path.
  await expect(pollLink).toHaveAttribute('href', '/dashboard/polls/create')
  const briefingLink = page.getByRole('link', {
    name: 'Review the related meeting briefing',
  })
  await expect(briefingLink).toHaveAttribute(
    'href',
    `/dashboard/briefings/${MEETING_DATE}`,
  )

  await pollLink.click()
  await page.waitForURL('**/dashboard/polls/create')

  await page.goto(`/dashboard/community-issues/${housingId}`, {
    waitUntil: 'domcontentloaded',
  })
  await WaitHelper.waitForPageReady(page)
  await page
    .getByRole('link', { name: 'Review the related meeting briefing' })
    .click()
  await page.waitForURL(`**/dashboard/briefings/${MEETING_DATE}`)
})
