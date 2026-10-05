import { test } from '@playwright/test'
import { authenticateTestUser } from 'tests/utils/api-registration'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  expectAttachmentRoundTrip,
  LIBRARY_BUDGET_PDF,
  openFooterChat,
  relayChatAttachmentUploads,
} from 'src/helpers/chatAttachments.helper'

// Runs on PRs for the same reasons as the Chief of Staff attachments spec.
test.describe('Campaign Manager attachments', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
    await relayChatAttachmentUploads(page, LIBRARY_BUDGET_PDF)
  })

  test('answers from an attached PDF with a citation that opens it', async ({
    page,
  }) => {
    await authenticateTestUser(page, { isolated: true })

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await NavigationHelper.dismissOverlays(page)
    await openFooterChat(page, 'Open campaign manager chat')

    await expectAttachmentRoundTrip(
      page,
      "Don't upload voter files, donor records, or anything you're not allowed to share.",
    )
  })
})
