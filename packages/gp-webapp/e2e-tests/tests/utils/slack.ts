import { WebClient } from '@slack/web-api'
import type { MessageElement } from '@slack/web-api/dist/types/response/ConversationsHistoryResponse'
import retry from 'p-retry'

const token = process.env.SLACK_BOT_TOKEN

// gp-api posts these from its SQS consumer, which handles one message at a
// time, so a message lands behind whatever is queued ahead of it: ~4s on a
// quiet queue, over 4 minutes behind a backlog on 2026-10-21. Four tries a
// few seconds apart failed on the queue, not on the feature.
const SLACK_MESSAGE_WAIT_MS = 3 * 60 * 1000

const getSlackClient = () => {
  if (!token) {
    throw new Error('SLACK_BOT_TOKEN is not set')
  }
  return new WebClient(process.env.SLACK_BOT_TOKEN)
}

export const waitForSlackMessage = async (params: {
  channel: string
  matching: (message: MessageElement) => boolean
}) => {
  const slack = getSlackClient()

  return retry(
    async () => {
      const messages = await slack.conversations.history({
        channel: params.channel,
      })

      const match = messages.messages?.find((message) =>
        params.matching(message),
      )

      if (!match) {
        throw new Error('No matching message found')
      }

      return match
    },
    {
      minTimeout: 1000,
      maxTimeout: 5000,
      retries: 100,
      maxRetryTime: SLACK_MESSAGE_WAIT_MS,
    },
  )
}

export const downloadSlackFile = async (fileId: string) => {
  const slack = getSlackClient()
  const { file } = await slack.files.info({ file: fileId })

  if (!file?.url_private_download) {
    throw new Error(`File does not have a download URL: ${fileId}`)
  }

  const response = await fetch(file.url_private_download, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()

  return Buffer.from(arrayBuffer)
}
