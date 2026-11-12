import { expect, test } from 'src/fixtures/test'
import { setupElectedOfficeUser } from 'src/helpers/organizations'
import {
  blockSlowScripts,
  NavigationHelper,
} from 'src/helpers/navigation.helper'
import {
  attachFileFromComposer,
  expectAttachmentReady,
  expectAttachmentRoundTrip,
  LIBRARY_BUDGET_PDF,
  LIBRARY_BUDGET_QUESTION,
  LIBRARY_BUDGET_TXT,
  openFooterChat,
  relayChatAttachmentUploads,
} from 'src/helpers/chatAttachments.helper'

// Runs on PRs: the model round trip is an outbound call the preview's own
// gp-api makes, and the S3 upload is relayed past the bucket's CORS (see
// relayChatAttachmentUploads).
test.describe('Chief of Staff attachments', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
  })

  test('answers from an attached PDF with a citation that opens it', async ({
    page,
  }) => {
    await relayChatAttachmentUploads(page, LIBRARY_BUDGET_PDF)
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

  test('answers from an attached text file once its text is extracted', async ({
    page,
  }) => {
    await relayChatAttachmentUploads(page, LIBRARY_BUDGET_TXT)
    await setupElectedOfficeUser(page)

    await page.goto('/dashboard/chief-of-staff', {
      waitUntil: 'domcontentloaded',
    })
    await NavigationHelper.dismissOverlays(page)
    await openFooterChat(page, 'Open Chief of Staff chat')

    const chat = page.getByRole('dialog')
    await attachFileFromComposer(chat, page, LIBRARY_BUDGET_TXT)
    // A PDF is ready at upload; a text file stays processing until gp-api's
    // extractChatAttachment job stores its text, and the chat polls for it.
    await expectAttachmentReady(chat, 'library-budget.txt')

    await chat
      .getByRole('textbox', { name: 'Ask a question' })
      .fill(LIBRARY_BUDGET_QUESTION)
    await chat.getByRole('button', { name: 'Send' }).click()

    // The figure only appears if the extracted text reached the model.
    await expect(
      chat
        .getByTestId('cos-conversation')
        .getByText(/412,?000/)
        .first(),
    ).toBeVisible({ timeout: 120_000 })
  })
})
