import { WebClient } from '@slack/web-api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendTevynAPIPollMessage } from './polls.utils'

const filesUploadV2 = vi.fn().mockResolvedValue({ ok: true })
const fakeClient = { filesUploadV2 } as unknown as WebClient

const POLL_ID = '01a0cbda-e798-76c3-9e49-c1cec92ce62c'

const send = (isExpansion = false) =>
  sendTevynAPIPollMessage(fakeClient, {
    message: 'Which roads need repair first? Reply to tell me.',
    pollId: POLL_ID,
    scheduledDate: 'Now',
    csv: {
      fileContent: Buffer.from('id,firstName,lastName,cellPhone\n'),
      filename: `${POLL_ID}.csv`,
    },
    userInfo: { name: 'Jane Doe', email: 'jane@example.org' },
    isExpansion,
  })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const blocks = (): any[] => {
  const call = filesUploadV2.mock.calls[0]
  if (!call) throw new Error('filesUploadV2 was never called')
  return call[0].blocks
}

const blocksText = () => JSON.stringify(blocks())

describe('sendTevynAPIPollMessage', () => {
  beforeEach(() => {
    filesUploadV2.mockClear()
    vi.stubEnv('GP_ADMIN_BASE_URL', 'https://admin.example.org')
    vi.stubEnv('SERVE_ANALYSIS_BUCKET_NAME', 'serve-analyze-data-test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // Fulfilment handles polls and Serve SMS sends from the same channel, and
  // the point of one upload surface is that they never have to work out
  // which kind of send a message is about. A button here and a bare link
  // there is exactly the choice that surface exists to remove, so this
  // asserts the affordance and not just the URL.
  it('offers the upload as a button, the way an SMS send does', async () => {
    await send()

    const actions = blocks().find((block) => block.type === 'actions')
    expect(actions).toBeDefined()
    expect(actions.elements[0]).toMatchObject({
      type: 'button',
      style: 'primary',
      text: { type: 'plain_text', text: 'Upload results CSV' },
      url: `https://admin.example.org/dashboard/outreach-results/poll/${POLL_ID}`,
    })
  })

  // The CLI line is a fallback for a day the page is unavailable. It stays
  // until fulfilment has run on the page for a while, so its removal is a
  // decision rather than a side effect of some later edit.
  it('keeps the cp command as a labelled backup below the button', async () => {
    await send()

    const text = blocksText()
    expect(text).toContain('Backup for POLLS only')
    expect(text).toContain(
      `aws s3 cp /path/to/local/file.csv s3://serve-analyze-data-test/input/${POLL_ID}.csv`,
    )
  })

  // Naming polls is what stops a text send's results being copied into a
  // bucket that has nothing to do with them, which would look like it
  // worked and deliver nothing.
  it('tells the reader the backup is for polls and not for text sends', async () => {
    await send()

    expect(blocksText()).toContain('Text message results must go through')
  })

  it('carries the poll id so the send identity travels with the message', async () => {
    await send()

    expect(blocksText()).toContain(POLL_ID)
  })
})
