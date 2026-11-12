import { expect, type Page, test } from 'src/fixtures/test'
import type { MessageElement } from '@slack/web-api/dist/types/response/ConversationsHistoryResponse'
import { parse as parseCSV } from 'csv-parse/sync'
import { addBusinessDays, format, subDays } from 'date-fns'
import type {
  SeedPollResultsRequest,
  SeedPollResultsResponse,
} from '@goodparty_org/contracts'
import { fetchListMembers } from 'src/helpers/crm-contacts-e2e'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import { setupElectedOfficeUser } from 'src/helpers/organizations'
import { eventually } from 'tests/utils/eventually'
import { downloadSlackFile, waitForSlackMessage } from 'tests/utils/slack'

// The pollCreation and pollExpansion jobs, run by the preview's own gp-api:
// each samples the poll's recipients and posts them as a CSV to
// #tevyn-api-test. The poll is created through the API and the poll to expand
// is seeded as completed, so this needs neither the onboarding UI nor the
// analysis pipeline; polls-onboarding.spec.ts (@dev-only) drives both on dev.

type CsvRow = {
  id: string
  firstName: string
  lastName: string
  cellPhone: string
}

const district = {
  zip: '82001',
  office: 'Cheyenne City Council - Ward 1',
}

const waitForPollCsv = async (
  matching: (message: MessageElement) => boolean,
): Promise<CsvRow[]> => {
  const slackMessage = await waitForSlackMessage({
    // #tevyn-api-test
    channel: 'C09KUHEUY95',
    matching,
  })
  const fileId = slackMessage.files?.at(0)?.id
  if (!fileId) {
    throw new Error('No file id found in slack message')
  }
  const csv = await downloadSlackFile(fileId)
  return parseCSV(csv.toString('utf8'), { columns: true })
}

const isPollMessage = (message: MessageElement, pollId: string) =>
  !!message.text?.includes(`*Poll ID:* \`${pollId}\``)

const isExpansionMessage = (message: MessageElement) =>
  !!message.text?.includes('This is a poll _expansion_')

const pickDateOnCalendar = async (page: Page, date: Date) => {
  const dateLocator = page.locator(`[data-day="${format(date, 'yyyy-MM-dd')}"]`)

  // If the date is not visible (e.g., it's in the next month), navigate forward
  if (!(await dateLocator.isVisible())) {
    await page.getByRole('button', { name: 'Go to the Next Month' }).click()
  }

  await dateLocator.click()
}

test.beforeEach(async ({ page }) => {
  await blockSlowScripts(page)
})

test('a new poll and its paid expansion are sent to Tevyn', async ({
  page,
}) => {
  test.setTimeout(10 * 60 * 1000)
  const { client } = await setupElectedOfficeUser(page, district)

  const { data: created } = await client.post<{ id: string }>(
    '/v1/polls/initial-poll',
    {
      message: 'What is the most important issue in our community?',
      swornInDate: format(subDays(new Date(), 1), 'yyyy-MM-dd'),
    },
  )

  const creationRows = await waitForPollCsv(
    (message) =>
      isPollMessage(message, created.id) && !isExpansionMessage(message),
  )
  expect(creationRows).toHaveLength(500)

  // A completed low-confidence poll, as the analysis pipeline leaves one, that
  // has already texted this constituent.
  const [person] = await fetchListMembers(client, 'all')
  expect(person, 'a constituent in the district').toBeTruthy()
  const { data: seeded } = await client.post<SeedPollResultsResponse>(
    '/v1/test-fixtures/polls/results',
    {
      personId: person!.id,
      issueTitle: 'Traffic Congestion',
      issueSummary: 'Traffic congestion is a major problem in the city.',
    } satisfies SeedPollResultsRequest,
  )

  await page.goto(`/dashboard/polls/${seeded.pollId}`)
  await NavigationHelper.dismissOverlays(page)
  await page
    .getByRole('button', { name: 'Gather more feedback' })
    .click({ timeout: 30_000 })

  await page.getByText('Recommended').click()
  await page
    .getByRole('button', { name: 'Pick Send Date' })
    .click({ force: true })
  await pickDateOnCalendar(page, addBusinessDays(new Date(), 7))
  await page.getByRole('button', { name: 'Review' }).click({ force: true })
  await page
    .getByRole('button', { name: 'Go to payment' })
    .click({ force: true })

  // Same Stripe card form, and the same layout handling, as
  // polls-onboarding.spec.ts; see e2e-tests/AGENTS.md (Gotchas).
  const stripeIframe = page
    .locator('iframe[title="Secure payment input frame"]')
    .first()
  await expect(stripeIframe).toBeVisible({ timeout: 30_000 })

  const stripeFrame = page
    .frameLocator('iframe[title="Secure payment input frame"]')
    .first()
  const cardInput = stripeFrame.locator('#payment-numberInput')
  await expect(cardInput).toBeVisible({ timeout: 30_000 })
  await expect(cardInput).toBeEditable({ timeout: 30_000 })
  await page.waitForTimeout(2_000)

  await cardInput.fill('4242424242424242')
  await page.waitForTimeout(500)
  await stripeFrame.locator('#payment-expiryInput').fill('0135')
  await page.waitForTimeout(500)
  await stripeFrame.locator('#payment-cvcInput').fill('123')
  await page.waitForTimeout(500)
  await stripeFrame.locator('#payment-countryInput').selectOption('US')
  await page.waitForTimeout(500)
  await stripeFrame.locator('#payment-postalCodeInput').fill('82001')
  await page.waitForTimeout(500)
  const linkOptIn = stripeFrame.locator('#payment-linkOptInInput')
  if ((await linkOptIn.count()) > 0 && (await linkOptIn.isChecked())) {
    await linkOptIn.uncheck()
  }
  await page.waitForTimeout(1_000)

  const purchaseButton = page.getByRole('button', {
    name: 'Complete Purchase',
  })
  await expect(purchaseButton).toBeEnabled({ timeout: 30_000 })
  await purchaseButton.scrollIntoViewIfNeeded()
  await purchaseButton.click()

  // The browser's complete-checkout-session call fulfils the expansion on the
  // preview. Stripe's webhook goes to dev, which does not have this poll.
  await page.waitForURL(
    (url) => new URL(url).pathname.includes('/expand-payment-success'),
    { timeout: 45_000 },
  )

  const audienceSize = await eventually(
    { that: 'the poll is expanding', minTimeout: 500, maxTimeout: 5_000 },
    async () => {
      const { data } = await client.get<{
        status: string
        audienceSize: number
      }>(`/v1/polls/${seeded.pollId}`)
      expect(data.status).toBe('scheduled')
      expect(data.audienceSize).toBeGreaterThan(1)
      return data.audienceSize
    },
  )

  const expansionRows = await waitForPollCsv(
    (message) =>
      isPollMessage(message, seeded.pollId) && isExpansionMessage(message),
  )
  // Everyone the expansion adds, and nobody the poll already texted.
  expect(expansionRows).toHaveLength(audienceSize - 1)
  expect(expansionRows.map((row) => row.id)).not.toContain(person!.id)
})
