import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpService } from '@nestjs/axios'
import { PinoLogger } from 'nestjs-pino'
import { of } from 'rxjs'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { SlackService } from './slack.service'
import { SlackChannel, SlackMessageType } from '../slackService.types'

vi.mock('../slackService.config', () => ({
  SLACK_CHANNEL_IDS: {
    'bot-dev': { channelId: 'WEBHOOK_ID', channelToken: 'WEBHOOK_TOKEN' },
    'shared-goodparty-peerly-10dlc': { apiChannelId: 'C_SHARED' },
    'bot-ai': { apiChannelId: undefined },
  },
}))

const testMessage = {
  blocks: [
    {
      type: SlackMessageType.SECTION,
      text: { type: SlackMessageType.MRKDWN, text: 'hello' },
    },
  ],
}

describe('SlackService.message', () => {
  let service: SlackService
  let mockHttpPost: ReturnType<typeof vi.fn>
  let mockPostMessage: ReturnType<typeof vi.fn>
  let logger: PinoLogger

  beforeEach(() => {
    mockHttpPost = vi.fn().mockReturnValue(of({ data: 'ok' }))
    logger = createMockLogger()
    service = new SlackService(
      { post: mockHttpPost } as Partial<HttpService> as HttpService,
      logger,
    )
    mockPostMessage = vi.fn().mockResolvedValue({ ok: true })
    service.client.chat.postMessage =
      mockPostMessage as unknown as typeof service.client.chat.postMessage
  })

  it('posts a webhook-configured channel through the webhook URL', async () => {
    const result = await service.message(testMessage, SlackChannel.botDev)

    expect(result).toBe('ok')
    expect(mockHttpPost).toHaveBeenCalledWith(
      expect.stringContaining('/WEBHOOK_ID/WEBHOOK_TOKEN'),
      testMessage,
      expect.anything(),
    )
    expect(mockPostMessage).not.toHaveBeenCalled()
  })

  // A Slack Connect channel owned by the other org can't have one of our
  // incoming webhooks, so it must go through the Web API instead.
  it('posts an API-configured channel through chat.postMessage', async () => {
    const result = await service.message(
      testMessage,
      SlackChannel.sharedGoodpartyPeerly10Dlc,
    )

    expect(result).toBe('ok')
    expect(mockPostMessage).toHaveBeenCalledWith({
      channel: 'C_SHARED',
      text: '',
      blocks: testMessage.blocks,
    })
    expect(mockHttpPost).not.toHaveBeenCalled()
  })

  // Callers roll back once-only claims (the nightly report's vendor
  // escalations) when message() resolves undefined — a not_in_channel or
  // network failure must not consume the claim.
  it('resolves undefined and warns when chat.postMessage rejects', async () => {
    mockPostMessage.mockRejectedValue(new Error('not_in_channel'))

    const result = await service.message(
      testMessage,
      SlackChannel.sharedGoodpartyPeerly10Dlc,
    )

    expect(result).toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: SlackChannel.sharedGoodpartyPeerly10Dlc,
      }),
    )
  })

  it('resolves undefined without calling Slack when the API channel ID is unset', async () => {
    const result = await service.message(testMessage, SlackChannel.botAi)

    expect(result).toBeUndefined()
    expect(mockPostMessage).not.toHaveBeenCalled()
    expect(mockHttpPost).not.toHaveBeenCalled()
  })
})
