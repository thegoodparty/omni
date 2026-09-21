import { WebClient } from '@slack/web-api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SLACK_CHANNEL_IDS } from '@/vendors/slack/slackService.config'
import { SlackChannel } from '@/vendors/slack/slackService.types'
import {
  outreachResultsUploadUrl,
  sendTextDeliverySlackMessage,
  type TextDeliverySlackMessageArgs,
} from './textDeliverySlack.util'

const filesUploadV2 = vi.fn().mockResolvedValue({ ok: true })
const fakeClient = { filesUploadV2 } as unknown as WebClient

const baseArgs = (
  overrides: Partial<TextDeliverySlackMessageArgs> = {},
): TextDeliverySlackMessageArgs => ({
  outreachId: 'outreach-abc-123',
  sendSeq: 1,
  message: 'Council meets Thursday at 6pm. Reply with questions.',
  scheduledDate: 'Now',
  recipientCount: 340,
  csv: {
    fileContent: Buffer.from('id,firstName,lastName,cellPhone\n'),
    filename: 'outreach-abc-123-1.csv',
  },
  officialInfo: { name: 'Jane Doe', email: 'jane@example.org' },
  ...overrides,
})

const callPayload = () => {
  const call = filesUploadV2.mock.calls[0]
  if (!call) {
    throw new Error('filesUploadV2 was never called')
  }
  return call[0]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const blocks = (): any[] => callPayload().blocks

const blocksText = () => JSON.stringify(blocks())

describe('textDeliverySlack.util', () => {
  beforeEach(() => {
    filesUploadV2.mockClear()
    vi.stubEnv('GP_ADMIN_BASE_URL', 'https://admin.example.org')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('outreachResultsUploadUrl', () => {
    it('scopes the admin route to the outreach id', () => {
      expect(outreachResultsUploadUrl('outreach-abc-123')).toBe(
        'https://admin.example.org/dashboard/outreach-results/outreach-abc-123',
      )
    })

    it('does not double the slash when the base url has a trailing slash', () => {
      vi.stubEnv('GP_ADMIN_BASE_URL', 'https://admin.example.org/')

      expect(outreachResultsUploadUrl('xyz')).toBe(
        'https://admin.example.org/dashboard/outreach-results/xyz',
      )
    })

    it('falls back to the local admin app when the base url is unset', () => {
      vi.stubEnv('GP_ADMIN_BASE_URL', '')

      expect(outreachResultsUploadUrl('xyz')).toBe(
        'http://localhost:3500/dashboard/outreach-results/xyz',
      )
    })
  })

  describe('sendTextDeliverySlackMessage', () => {
    it('uploads the recipient CSV to the existing tevyn api channel', async () => {
      await sendTextDeliverySlackMessage(fakeClient, baseArgs())

      const payload = callPayload()
      expect(payload.channel_id).toBe(
        SLACK_CHANNEL_IDS[SlackChannel.botTevynApi].channelId,
      )
      expect(payload.filename).toBe('outreach-abc-123-1.csv')
      expect(payload.file).toBeInstanceOf(Buffer)
    })

    it('ends with a button linking at the per-send admin upload page', async () => {
      await sendTextDeliverySlackMessage(fakeClient, baseArgs())

      const actions = blocks().at(-1)
      expect(actions.type).toBe('actions')
      expect(actions.elements[0]).toMatchObject({
        type: 'button',
        url: 'https://admin.example.org/dashboard/outreach-results/outreach-abc-123',
      })
    })

    it('never emits the aws s3 cp instruction the poll message carries', async () => {
      await sendTextDeliverySlackMessage(fakeClient, baseArgs())

      expect(blocksText()).not.toContain('aws s3 cp')
      expect(blocksText()).not.toContain('s3://')
    })

    it('carries the outreach id, recipient count and scheduled date', async () => {
      await sendTextDeliverySlackMessage(
        fakeClient,
        baseArgs({ scheduledDate: 'Jan 5, 2026 9:00 AM ET' }),
      )

      const text = blocksText()
      expect(text).toContain('*Outreach ID:* `outreach-abc-123`')
      expect(text).toContain('*Recipients:* 340')
      expect(text).toContain('*Scheduled Date:* Jan 5, 2026 9:00 AM ET')
    })

    it('carries the official name, email and message body', async () => {
      await sendTextDeliverySlackMessage(fakeClient, baseArgs())

      const text = blocksText()
      expect(text).toContain('Jane Doe')
      expect(text).toContain('jane@example.org')
      expect(text).toContain(
        'Council meets Thursday at 6pm. Reply with questions.',
      )
    })

    it('omits the phone bullet when no phone is given', async () => {
      await sendTextDeliverySlackMessage(fakeClient, baseArgs())

      expect(blocksText()).not.toContain('Phone: ')
    })

    it('includes the phone bullet when a phone is given', async () => {
      await sendTextDeliverySlackMessage(
        fakeClient,
        baseArgs({
          officialInfo: {
            name: 'Jane Doe',
            email: 'jane@example.org',
            phone: '555-222-1111',
          },
        }),
      )

      expect(blocksText()).toContain('555-222-1111')
    })

    it('omits the image block when there is no image', async () => {
      await sendTextDeliverySlackMessage(fakeClient, baseArgs())

      expect(blocksText()).not.toContain('https://images.example.org')
    })

    it('includes the image url when one is given', async () => {
      await sendTextDeliverySlackMessage(
        fakeClient,
        baseArgs({ imageUrl: 'https://images.example.org/flyer.png' }),
      )

      expect(blocksText()).toContain('https://images.example.org/flyer.png')
    })

    it('omits the combine-responses note on the first send', async () => {
      await sendTextDeliverySlackMessage(fakeClient, baseArgs({ sendSeq: 1 }))

      expect(blocksText()).not.toContain('COMBINE previous responses')
    })

    it('includes the combine-responses note on a re-send', async () => {
      await sendTextDeliverySlackMessage(fakeClient, baseArgs({ sendSeq: 2 }))

      const text = blocksText()
      expect(text).toContain('re-send')
      expect(text).toContain('send #2')
      expect(text).toContain(
        'COMBINE previous responses with the new responses',
      )
    })

    it('falls back to a placeholder when the message body is empty', async () => {
      await sendTextDeliverySlackMessage(fakeClient, baseArgs({ message: '' }))

      expect(blocksText()).toContain('No message provided')
    })
  })
})
