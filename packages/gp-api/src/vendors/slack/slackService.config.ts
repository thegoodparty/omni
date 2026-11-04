import { SlackChannel } from './slackService.types'

export const SLACK_CHANNEL_IDS = {
  [SlackChannel.botDev]: {
    channelId: process.env.SLACK_BOT_DEV_CHANNEL_ID,
    channelToken: process.env.SLACK_BOT_DEV_CHANNEL_TOKEN,
  },
  [SlackChannel.userFeedback]: {
    channelId: process.env.SLACK_USER_FEEDBACK_CHANNEL_ID,
    channelToken: process.env.SLACK_USER_FEEDBACK_CHANNEL_TOKEN,
  },
  [SlackChannel.botAi]: {
    channelId: process.env.SLACK_BOT_AI_CHANNEL_ID,
    channelToken: process.env.SLACK_BOT_AI_CHANNEL_TOKEN,
  },
  [SlackChannel.botPolitics]: {
    channelId: process.env.SLACK_BOT_POLITICS_CHANNEL_ID,
    channelToken: process.env.SLACK_BOT_POLITICS_CHANNEL_TOKEN,
  },
  [SlackChannel.botFeedback]: {
    channelId: process.env.SLACK_BOT_FEEDBACK_CHANNEL_ID,
    channelToken: process.env.SLACK_BOT_FEEDBACK_CHANNEL_TOKEN,
  },
  [SlackChannel.bot10DlcCompliance]: {
    channelId: process.env.SLACK_BOT_10DLC_COMPLIANCE_CHANNEL_ID,
    channelToken: process.env.SLACK_BOT_10DLC_COMPLIANCE_CHANNEL_TOKEN,
  },
  [SlackChannel.botDeletions]: {
    channelId: process.env.SLACK_BOT_DELETIONS_CHANNEL_ID,
    channelToken: process.env.SLACK_BOT_DELETIONS_CHANNEL_TOKEN,
  },
  [SlackChannel.botTevynApi]: {
    channelId: process.env.SLACK_BOT_TEVYN_API_CHANNEL_ID,
    channelToken: process.env.SLACK_BOT_TEVYN_API_CHANNEL_TOKEN,
  },
  [SlackChannel.casClickupTasks]: {
    channelId: process.env.SLACK_CAS_CLICKUP_TASKS_CHANNEL_ID,
    channelToken: process.env.SLACK_CAS_CLICKUP_TASKS_CHANNEL_TOKEN,
  },
  [SlackChannel.sharedGoodpartyPeerly10Dlc]: {
    // Slack Connect channel owned by Peerly — an incoming webhook can't be
    // created for it, so this channel posts via the Web API instead. The env
    // var must hold the real channel ID (C…), and the goodparty app must be
    // a member of the channel for chat.postMessage to land.
    apiChannelId: process.env.SLACK_SHARED_PEERLY_10DLC_CHANNEL_ID,
  },
}
