import { Sha256 } from '@aws-crypto/sha256-js'
import {
  BedrockAgentCoreClient,
  StartBrowserSessionCommand,
  StopBrowserSessionCommand,
} from '@aws-sdk/client-bedrock-agentcore'
import { SignatureV4 } from '@smithy/signature-v4'

// AWS's managed browser. A custom browser resource (recording, network
// settings) would replace it here.
const DEFAULT_BROWSER_IDENTIFIER = 'aws.browser.v1'
// A backstop only: the run's session is stopped when the run ends or sits
// idle. AgentCore bills a session until it stops or times out.
const SESSION_TIMEOUT_SECONDS = 60 * 60

export type CdpEndpoint = {
  wsUrl: string
  headers: Record<string, string>
  sessionId: string
  stop: () => Promise<void>
}

// Starts an AgentCore Browser session and signs its automation stream, a
// CDP WebSocket that Playwright's connectOverCDP drives. The signature is
// SigV4 on the connect request's headers, valid for one connection.
export const startAgentCoreBrowserSession = async (
  runId: string,
): Promise<CdpEndpoint> => {
  const region = process.env.AWS_REGION ?? 'us-west-2'
  const browserIdentifier =
    process.env.AGENT_BROWSER_IDENTIFIER ?? DEFAULT_BROWSER_IDENTIFIER
  const client = new BedrockAgentCoreClient({ region })
  const name = `run-${runId.replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 48)
  const started = await client.send(
    new StartBrowserSessionCommand({
      browserIdentifier,
      name,
      sessionTimeoutSeconds: SESSION_TIMEOUT_SECONDS,
      viewPort: { width: 1280, height: 800 },
    }),
  )
  const sessionId = started.sessionId
  if (!sessionId) throw new Error('AgentCore returned no browser session id')

  const stop = async () => {
    await client.send(
      new StopBrowserSessionCommand({ browserIdentifier, sessionId }),
    )
  }

  try {
    const host = `bedrock-agentcore.${region}.amazonaws.com`
    const path = `/browser-streams/${browserIdentifier}/sessions/${sessionId}/automation`
    const signer = new SignatureV4({
      service: 'bedrock-agentcore',
      region,
      credentials: client.config.credentials,
      sha256: Sha256,
    })
    const signed = await signer.sign({
      method: 'GET',
      protocol: 'wss:',
      hostname: host,
      path,
      headers: { host },
    })
    const headers = Object.fromEntries(
      Object.entries(signed.headers).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    )
    return { wsUrl: `wss://${host}${path}`, headers, sessionId, stop }
  } catch (err) {
    await stop().catch(() => undefined)
    throw err
  }
}
