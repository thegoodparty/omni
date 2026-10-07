import { expect, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'fs'
import { basename, resolve } from 'path'

// One page, one fact: a grounded answer has to repeat the figure, so the
// assertion does not depend on how the model phrases the rest of the reply.
export const LIBRARY_BUDGET_PDF = resolve(
  __dirname,
  '../fixtures/library-budget.pdf',
)
export const LIBRARY_BUDGET_FILE_NAME = 'library-budget.pdf'
export const LIBRARY_BUDGET_QUESTION =
  'According to the attached document, what is the Riverside Library renovation budget?'

// The browser uploads straight to the chat-attachments S3 bucket with a
// presigned POST. That bucket's CORS allows dev.goodparty.org and localhost,
// not a PR preview's vercel.app origin, so on a PR the browser would refuse
// S3's response. Playwright's route.fetch cannot replay the browser's
// multipart body (the file part arrives empty), so the relay re-posts the
// same presigned fields with the fixture's bytes from Node, which CORS does
// not apply to. The upload, finalize, and storage path stay real.
export const relayChatAttachmentUploads = async (
  page: Page,
  filePath: string,
): Promise<void> => {
  let uploadFields: Record<string, string> | null = null
  // Captured through a route rather than a response listener, so the
  // fields are in hand before the browser can start the S3 POST.
  await page.route(/\/attachments\/presign$/, async (route) => {
    const response = await route.fetch()
    if (response.ok()) {
      const body = (await response.json()) as {
        uploadFields: Record<string, string>
      }
      uploadFields = body.uploadFields
    }
    await route.fulfill({ response })
  })
  await page.route(/chat-attachments-[a-z]+.*amazonaws\.com/, async (route) => {
    if (!uploadFields) throw new Error('S3 upload before a presign response')
    const response = await page.request.post(route.request().url(), {
      multipart: {
        ...uploadFields,
        file: {
          name: basename(filePath),
          mimeType: 'application/pdf',
          buffer: readFileSync(filePath),
        },
      },
    })
    await route.fulfill({
      status: response.status(),
      body: await response.body(),
      headers: { 'access-control-allow-origin': '*' },
    })
  })
}

// Picks the file through the real file chooser the paperclip opens, the way
// a user does, rather than writing to the hidden input.
export const attachFileFromComposer = async (
  chat: Locator,
  page: Page,
  filePath: string,
): Promise<void> => {
  const chooser = page.waitForEvent('filechooser')
  await chat.getByRole('button', { name: 'Attach a file' }).click()
  await (await chooser).setFiles(filePath)
}

// "Reading: <file>" above the composer renders only once the attachment is
// ready, so it is the signal that upload and finalize both succeeded.
export const expectAttachmentReady = async (
  chat: Locator,
  fileName: string,
): Promise<void> => {
  await expect(chat.getByText(`Reading: ${fileName}`)).toBeVisible({
    timeout: 60_000,
  })
}

// The whole round trip both assistants share: attach through the paperclip,
// see the product's own safety toast, remove it, attach it again, and get an
// answer grounded in the file with a citation chip that opens it.
export const expectAttachmentRoundTrip = async (
  page: Page,
  guardCopy: string,
): Promise<void> => {
  const chat = page.getByRole('dialog')
  const reading = chat.getByText(`Reading: ${LIBRARY_BUDGET_FILE_NAME}`)
  await attachFileFromComposer(chat, page, LIBRARY_BUDGET_PDF)
  await expectAttachmentReady(chat, LIBRARY_BUDGET_FILE_NAME)
  await expect(page.getByText(guardCopy)).toBeVisible({ timeout: 10_000 })

  // Removed before any turn: the composer's chip row is not guaranteed to
  // survive the first reply, so removal is checked while it is on screen.
  await chat
    .getByRole('button', { name: `Remove ${LIBRARY_BUDGET_FILE_NAME}` })
    .click()
  await expect(reading).toBeHidden({ timeout: 15_000 })

  await attachFileFromComposer(chat, page, LIBRARY_BUDGET_PDF)
  await expectAttachmentReady(chat, LIBRARY_BUDGET_FILE_NAME)

  await chat
    .getByRole('textbox', { name: 'Ask a question' })
    .fill(LIBRARY_BUDGET_QUESTION)
  await chat.getByRole('button', { name: 'Send' }).click()

  const conversation = chat.getByTestId('cos-conversation')
  // The live model round trip can be slow; the figure only appears if the
  // document reached the model.
  await expect(conversation.getByText(/412,?000/).first()).toBeVisible({
    timeout: 120_000,
  })
  const citation = conversation
    .getByRole('button', { name: /^Open source \d+$/ })
    .first()
  await expect(citation).toBeVisible({ timeout: 30_000 })

  // The chip opens the stored file through a short-lived presigned URL. A
  // headless browser has no PDF viewer and downloads it instead, leaving the
  // new tab blank, so the presigned URL itself is the assertion.
  const download = page.waitForResponse(/\/attachments\/[^/]+\/download$/)
  const popup = page.waitForEvent('popup')
  await citation.click()
  const downloadResponse = await download
  expect(downloadResponse.status()).toBe(200)
  const { url } = (await downloadResponse.json()) as { url: string }
  expect(url).toMatch(/amazonaws\.com\/.*chat-attachments\//)
  await (await popup).close()
}

// Retried because a click that lands before the opener hydrates is a no-op,
// and nothing in the DOM says whether it has. The opener is Chief of Staff's
// footer bar on Serve and the sidebar's Chat pill on Win.
export const openFooterChat = async (
  page: Page,
  openLabel: string | RegExp,
): Promise<void> => {
  const composer = page.getByRole('textbox', { name: 'Ask a question' })
  await expect(async () => {
    await page
      .getByRole('button', { name: openLabel })
      .click({ timeout: 5_000 })
    await expect(composer).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 45_000 })
}
