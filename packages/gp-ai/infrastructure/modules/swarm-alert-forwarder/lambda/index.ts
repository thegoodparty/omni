import { createHmac, randomUUID } from 'node:crypto'

import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'

export interface SnsRecord {
  Sns: {
    TopicArn?: string
    Subject?: string
    Message: string
  }
}

export interface SnsEvent {
  Records: SnsRecord[]
}

interface AISecrets {
  SWARM_ALERT_WEBHOOK_URL?: string
  SWARM_ALERT_WEBHOOK_SECRET?: string
}

export interface SwarmAlertConfig {
  url: string
  signingKey: Buffer
}

export interface SwarmAlertPayload {
  topic: string
  subject: string | null
  message: unknown
  environment: string
}

const SECRET_NAME = process.env.SECRET_NAME ?? ''
const SECRET_REGION = process.env.SECRET_REGION ?? process.env.AWS_REGION ?? ''
const STANDARD_WEBHOOKS_PREFIX = 'whsec_'

const secretsClient = new SecretsManagerClient({ region: SECRET_REGION })

let cachedConfig: SwarmAlertConfig | null = null

export const decodeSigningSecret = (secret: string): Buffer | null => {
  const encoded = secret.startsWith(STANDARD_WEBHOOKS_PREFIX)
    ? secret.slice(STANDARD_WEBHOOKS_PREFIX.length)
    : secret
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    return null
  }
  const key = Buffer.from(encoded, 'base64')
  return key.length > 0 ? key : null
}

const sign = (
  key: Buffer,
  id: string,
  timestamp: string,
  body: string
): string =>
  `v1,${createHmac('sha256', key)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64')}`

export const parseMessage = (message: string): unknown => {
  try {
    return JSON.parse(message)
  } catch {
    return message
  }
}

export const buildPayload = (record: SnsRecord): SwarmAlertPayload => ({
  topic: record.Sns.TopicArn?.split(':').pop() ?? '',
  subject: record.Sns.Subject ?? null,
  message: parseMessage(record.Sns.Message),
  environment: process.env.ENVIRONMENT ?? '',
})

export const deliver = async (
  config: SwarmAlertConfig,
  payload: SwarmAlertPayload
): Promise<void> => {
  const body = JSON.stringify(payload)
  const id = randomUUID()
  const timestamp = String(Math.floor(Date.now() / 1000))

  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': sign(config.signingKey, id, timestamp, body),
    },
    body,
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`swarm webhook returned ${response.status}: ${detail}`)
  }
}

const loadConfig = async (): Promise<SwarmAlertConfig> => {
  if (cachedConfig) {
    return cachedConfig
  }

  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: SECRET_NAME })
  )

  if (!response.SecretString) {
    throw new Error(`${SECRET_NAME} has no secret string`)
  }

  const secrets: AISecrets = JSON.parse(response.SecretString)

  if (!secrets.SWARM_ALERT_WEBHOOK_URL) {
    throw new Error(`SWARM_ALERT_WEBHOOK_URL not found in ${SECRET_NAME}`)
  }

  if (!secrets.SWARM_ALERT_WEBHOOK_SECRET) {
    throw new Error(`SWARM_ALERT_WEBHOOK_SECRET not found in ${SECRET_NAME}`)
  }

  const signingKey = decodeSigningSecret(secrets.SWARM_ALERT_WEBHOOK_SECRET)

  if (!signingKey) {
    throw new Error(
      `SWARM_ALERT_WEBHOOK_SECRET in ${SECRET_NAME} must be base64, optionally prefixed with ${STANDARD_WEBHOOKS_PREFIX}`
    )
  }

  cachedConfig = { url: secrets.SWARM_ALERT_WEBHOOK_URL, signingKey }
  return cachedConfig
}

export const handler = async (event: SnsEvent): Promise<void> => {
  let config: SwarmAlertConfig | null = null

  for (const record of event.Records) {
    try {
      config ??= await loadConfig()
      await deliver(config, buildPayload(record))
    } catch (error) {
      cachedConfig = null
      throw error
    }
  }
}
