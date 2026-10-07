import { test } from '@playwright/test'
import { setupElectedOfficeUser } from 'src/helpers/organizations'
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

// Runs on PRs: the model round trip is an outbound call the preview's own
// gp-api makes, and the S3 upload is relayed past the bucket's CORS (see
// relayChatAttachmentUploads).
test.describe('Chief of Staff attachments', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
    await relayChatAttachmentUploads(page, LIBRARY_BUDGET_PDF)
  })

  test('answers from an attached PDF with a citation that opens it', async ({
    page,
  }) => {
    await setupElectedOfficeUser(page)

    await page.goto('/dashboard/chief-of-staff', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)
    await openFooterChat(page, 'Open Chief of Staff chat')

    await expectAttachmentRoundTrip(
      page,
      "Don't upload closed-session, privileged, or active-litigation material.",
    )
  })
})
