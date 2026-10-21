import { HttpService } from '@nestjs/axios'
import { Injectable, InternalServerErrorException } from '@nestjs/common'
import { Headers, MimeTypes } from 'http-constants-ts'
import { lastValueFrom } from 'rxjs'
import { SLACK_CHANNEL_IDS } from '../slackService.config'
import {
  FormattedSlackMessageArgs,
  SlackChannel,
  SlackMessage,
  SlackMessageType,
  VanitySlackMethodArgs,
} from '../slackService.types'
import { Block, WebClient } from '@slack/web-api'
import { serializeError } from 'serialize-error'
import { PinoLogger } from 'nestjs-pino'
import { resolveEnvVar } from '../../../shared/env/env'

const { WEBAPP_ROOT_URL } = process.env

const SLACK_NOT_CONFIGURED_MESSAGE =
  'Slack notifications are disabled: set SLACK_APP_ID and SLACK_APP_BOT_TOKEN'

const slackAppId = resolveEnvVar('SLACK_APP_ID')
const slackBotToken = resolveEnvVar('SLACK_APP_BOT_TOKEN')
const slackConfigured = slackAppId.configured && slackBotToken.configured
// In the disabled case the empty strings only keep these always-assigned;
// callers touching `client` directly must check `isConfigured` first, since
// an empty-token WebClient fires real requests that fail with invalid_auth.
const slackAppIdValue = slackAppId.configured ? slackAppId.value : ''

// TODO: Replace w/ this: https://tools.slack.dev/node-slack-sdk/web-api 🤦‍♂️
//  or better yet, this: https://www.npmjs.com/package/nestjs-slack
@Injectable()
export class SlackService {
  public client: WebClient
  public readonly isConfigured = slackConfigured

  constructor(
    private readonly httpService: HttpService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SlackService.name)
    this.client = new WebClient(
      slackBotToken.configured ? slackBotToken.value : '',
    )
    if (!slackConfigured) {
      this.logger.warn(SLACK_NOT_CONFIGURED_MESSAGE)
    }
  }

  private getChannelConfig(channel: SlackChannel) {
    // Slack channel config indexed by enum — Record index signature returns string | undefined
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const channelConfig = SLACK_CHANNEL_IDS[channel] as
      | { channelId: string; channelToken: string; apiChannelId?: never }
      | { apiChannelId: string | undefined; channelId?: never }
      | undefined
    if (!channelConfig) {
      throw new InternalServerErrorException(
        `Unknown slack channel: ${channel}`,
      )
    }

    return channelConfig
  }

  async message(message: SlackMessage, channel: SlackChannel) {
    // Matches the existing missing-apiChannelId contract below: resolve
    // undefined and warn rather than throw, so callers' once-only claims
    // (e.g. the nightly report's vendor escalations) roll back and retry.
    if (!slackConfigured) {
      this.logger.warn({ msg: SLACK_NOT_CONFIGURED_MESSAGE, channel })
      return undefined
    }
    const channelConfig = this.getChannelConfig(channel)
    if ('apiChannelId' in channelConfig) {
      return this.postViaWebApi(message, channelConfig.apiChannelId, channel)
    }
    const { channelId, channelToken } = channelConfig

    try {
      const { data } = (await lastValueFrom(
        this.httpService.post(
          `https://hooks.slack.com/services/${slackAppIdValue}/${channelId}/${channelToken}`,
          message,
          {
            headers: {
              [Headers.CONTENT_TYPE]: MimeTypes.APPLICATION_JSON,
            },
          },
        ),
      )) as { data: string }
      return data
    } catch (e: unknown) {
      this.logger.warn({
        msg: 'Failed to send slack message',
        channel,
        err: serializeError(e),
      })
      return undefined
    }
  }

  // Same failure contract as the webhook path: resolve undefined instead of
  // throwing, so callers' once-only claims (e.g. the nightly report's vendor
  // escalations) roll back and retry the next night.
  private async postViaWebApi(
    message: SlackMessage,
    apiChannelId: string | undefined,
    channel: SlackChannel,
  ): Promise<string | undefined> {
    if (!apiChannelId) {
      this.logger.warn({
        msg: 'Slack API channel ID not configured',
        channel,
      })
      return undefined
    }
    try {
      await this.client.chat.postMessage(
        message.blocks
          ? {
              channel: apiChannelId,
              text: message.text ?? '',
              blocks: message.blocks as Block[],
            }
          : { channel: apiChannelId, text: message.text ?? '' },
      )
      return 'ok'
    } catch (e: unknown) {
      this.logger.warn({
        msg: 'Failed to send slack message',
        channel,
        err: serializeError(e),
      })
      return undefined
    }
  }

  async errorMessage(
    { message, error }: VanitySlackMethodArgs,
    channel?: SlackChannel,
  ): Promise<string | undefined> {
    return await this.formattedMessage({
      message,
      // VanitySlackMethodArgs.error is typed as any — passed through to JSON.stringify for logging
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      error,
      channel: channel || SlackChannel.botDev,
    })
  }

  async aiMessage({
    message,
    error,
  }: VanitySlackMethodArgs): Promise<string | undefined> {
    return this.formattedMessage({
      message,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      error,
      channel: SlackChannel.botAi,
    })
  }

  private static readonly SLACK_BLOCK_TEXT_LIMIT = 3000

  async formattedMessage({
    message,
    error,
    channel,
  }: FormattedSlackMessageArgs) {
    let body = `${message}\n\n${error ? JSON.stringify(serializeError(error)) : ''}`
    if (body.length > SlackService.SLACK_BLOCK_TEXT_LIMIT) {
      body =
        body.slice(0, SlackService.SLACK_BLOCK_TEXT_LIMIT - 20) +
        '\n…[truncated]'
    }

    return await this.message(
      {
        blocks: [
          {
            type: SlackMessageType.SECTION,
            text: {
              type: SlackMessageType.MRKDWN,
              text: `__________________________________ \n *Message from server* \n ${WEBAPP_ROOT_URL}`,
            },
          },
          {
            type: SlackMessageType.SECTION,
            text: {
              type: SlackMessageType.MRKDWN,
              text: body,
            },
          },
        ],
      },
      channel,
    )
  }
}
