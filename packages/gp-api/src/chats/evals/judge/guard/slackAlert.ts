import { z } from 'zod'

// A direct `chat.postMessage` call, the same shape
// `.github/workflows/analytics-governance.yml`'s own failure notification
// uses from a workflow step. The guard runs under `npx tsx` from main's
// checkout with no Nest app booted (judge-guard.yml never boots gp-api), so
// this does not go through the DI-built SlackService — LlmService
// (`sweep.ts`) and the judge's S3 clients are constructed directly in this
// module for the same reason.
export interface SlackAlertEnv {
  readonly token: string | undefined
  readonly channelId: string | undefined
}

export const slackAlertEnvFromProcess = (
  env: NodeJS.ProcessEnv = process.env,
): SlackAlertEnv => ({
  token: env.SLACK_APP_BOT_TOKEN,
  channelId: env.SLACK_BOT_DEV_CHANNEL_ID,
})

export interface SlackPostResult {
  readonly posted: boolean
  readonly reason?: string
}

// Narrower than `typeof fetch` on purpose: the only shape this call needs,
// and a plain function type a test double can satisfy without reproducing
// every overload of the global `fetch`.
export type FetchJson = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ json: () => Promise<unknown> }>

export const postPickerFailureAlert = async (
  { token, channelId }: SlackAlertEnv,
  text: string,
  fetchImpl: FetchJson = fetch,
): Promise<SlackPostResult> => {
  if (token === undefined || token === '') {
    return { posted: false, reason: 'SLACK_APP_BOT_TOKEN not set' }
  }
  if (channelId === undefined || channelId === '') {
    return { posted: false, reason: 'SLACK_BOT_DEV_CHANNEL_ID not set' }
  }
  const response = await fetchImpl('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel: channelId, text }),
  })
  const body = SlackApiResponseSchema.parse(await response.json())
  if (!body.ok) {
    return { posted: false, reason: body.error ?? 'unknown Slack API error' }
  }
  return { posted: true }
}

const SlackApiResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
})
