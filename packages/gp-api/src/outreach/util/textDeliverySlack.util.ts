import { SLACK_CHANNEL_IDS } from '@/vendors/slack/slackService.config'
import { SlackChannel } from '@/vendors/slack/slackService.types'
import { WebClient } from '@slack/web-api'

/**
 * Base URL of the gp-admin app. The Slack handoff links fulfilment straight at
 * the per-send results upload page, so the identity of the send travels with
 * the message instead of being retyped.
 *
 * Read at call time rather than module load so a test (or a redeployed task
 * definition) can change it without re-importing this module.
 */
const DEFAULT_GP_ADMIN_BASE_URL = 'http://localhost:3500'

/** Route owned by A8 (`gp-admin/src/app/dashboard/outreach-results/[id]`). */
export const outreachResultsUploadUrl = (outreachId: string) => {
  const base = process.env.GP_ADMIN_BASE_URL || DEFAULT_GP_ADMIN_BASE_URL
  return `${base.replace(/\/+$/, '')}/dashboard/outreach-results/${outreachId}`
}

export type TextDeliverySlackMessageArgs = {
  /** The spine outreach id. Scopes the upload page and identifies the send. */
  outreachId: string
  /** 1 for the first send, >1 for a re-send of the same outreach. */
  sendSeq: number
  /** The text body that goes to recipients. */
  message: string
  /** Already formatted for humans, e.g. `Now` or `Jan 5, 2026 9:00 AM ET`. */
  scheduledDate: string
  /** How many rows are in the attached CSV. */
  recipientCount: number
  csv: {
    fileContent: Buffer
    filename: string
  }
  imageUrl?: string
  officialInfo: { name: string; email: string; phone?: string }
}

/**
 * Posts a text send's recipient CSV to the fulfilment channel so a human can
 * send the messages.
 *
 * Deliberately a copy of the block structure of `sendTevynAPIPollMessage`
 * rather than a shared call: polls moves onto this helper in a later wave, and
 * until then the two coexist. Two differences from the poll version:
 *
 * 1. It ends with a per-send button pointing at the gp-admin results upload
 *    page instead of an `aws s3 cp` command fulfilment has to type correctly.
 * 2. The re-send note is keyed on `sendSeq > 1`.
 *
 * Routing note: this posts to the existing `SlackChannel.botTevynApi` channel
 * on purpose. Channel ids come from env, and preview inherits the dev
 * parameter set, so reusing the constant keeps per-environment routing correct
 * without a new secret that would be unset in preview.
 */
export const sendTextDeliverySlackMessage = async (
  client: WebClient,
  {
    outreachId,
    sendSeq,
    message,
    scheduledDate,
    recipientCount,
    csv,
    imageUrl,
    officialInfo,
  }: TextDeliverySlackMessageArgs,
) => {
  const isResend = sendSeq > 1
  const uploadUrl = outreachResultsUploadUrl(outreachId)

  await client.filesUploadV2({
    channel_id: SLACK_CHANNEL_IDS[SlackChannel.botTevynApi].channelId,
    file: csv.fileContent,
    filename: csv.filename,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '📋 Text Send Recipients 📋',
          emoji: true,
        },
      },
      ...(isResend
        ? [
            {
              type: 'section' as const,
              text: {
                type: 'mrkdwn' as const,
                text: `*NOTE*: This is a _re-send_ (send #${sendSeq}). When uploading the results CSV, be sure to COMBINE previous responses with the new responses, and upload a single CSV.`,
              },
            },
            {
              type: 'divider' as const,
            },
          ]
        : []),
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Outreach ID:* \`${outreachId}\``,
        },
      },
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              {
                type: 'emoji',
                name: 'gp',
              },
              {
                type: 'text',
                text: ' Elected Official Information:',
                style: {
                  bold: true,
                },
              },
            ],
          },
          {
            type: 'rich_text_list',
            style: 'bullet',
            elements: [
              {
                type: 'rich_text_section',
                elements: [
                  {
                    type: 'text',
                    text: 'Name: ',
                    style: {
                      bold: true,
                    },
                  },
                  {
                    type: 'text',
                    text: String(officialInfo.name),
                  },
                ],
              },
              {
                type: 'rich_text_section',
                elements: [
                  {
                    type: 'text',
                    text: 'Email: ',
                    style: {
                      bold: true,
                    },
                  },
                  {
                    type: 'text',
                    text: String(officialInfo.email),
                  },
                ],
              },
              ...(officialInfo.phone
                ? [
                    {
                      type: 'rich_text_section' as const,
                      elements: [
                        {
                          type: 'text' as const,
                          text: 'Phone: ',
                          style: {
                            bold: true,
                          },
                        },
                        {
                          type: 'text' as const,
                          text: String(officialInfo.phone),
                        },
                      ],
                    },
                  ]
                : []),
            ],
          },
        ],
      },
      {
        type: 'divider',
      },
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              {
                type: 'emoji',
                name: 'speech_balloon',
              },
              {
                type: 'text',
                text: ' Message:',
                style: {
                  bold: true,
                },
              },
            ],
          },
          {
            type: 'rich_text_quote',
            elements: [
              {
                type: 'text',
                text: message || 'No message provided',
              },
            ],
          },
        ],
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Scheduled Date:* ${scheduledDate}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Recipients:* ${recipientCount}`,
        },
      },
      {
        type: 'divider',
      },
      ...(imageUrl
        ? [
            {
              type: 'section' as const,
              text: {
                type: 'mrkdwn' as const,
                text: String(imageUrl),
              },
            },
          ]
        : []),
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'When the responses are back, upload the results CSV for *this send* here:',
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            style: 'primary',
            text: {
              type: 'plain_text',
              text: 'Upload results CSV',
              emoji: true,
            },
            url: uploadUrl,
            action_id: 'outreach_results_upload',
          },
        ],
      },
    ],
  })
}
