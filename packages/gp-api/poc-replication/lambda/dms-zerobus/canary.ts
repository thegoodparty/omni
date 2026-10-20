import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { z } from 'zod'

// Writes one synthetic change-log row a minute so the consumer can prove the
// whole path (slot, DMS, Kinesis, Lambda, Zerobus) is moving. DMS can report
// RUNNING while delivering nothing; without a steady write an idle log and a
// stalled pipeline look the same.

const env = z
  .object({
    DB_HOST: z.string().min(1),
    DB_NAME: z.string().min(1),
    DB_SECRET_ARN: z.string().min(1),
    CANARY_ORG_SLUG: z.string().min(1),
    CANARY_SOURCE: z.string().min(1),
  })
  .parse(process.env)

const masterSecretSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

const secrets = new SecretsManagerClient({})

export const handler = async (): Promise<void> => {
  const secret = await secrets.send(
    new GetSecretValueCommand({ SecretId: env.DB_SECRET_ARN }),
  )
  const { username, password } = masterSecretSchema.parse(
    JSON.parse(secret.SecretString ?? '{}'),
  )
  const client = new Client({
    host: env.DB_HOST,
    port: 5432,
    database: env.DB_NAME,
    user: username,
    password,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
  })
  await client.connect()
  try {
    const eventId = randomUUID()
    await client.query(
      `INSERT INTO org_contact_event (event_id, org_slug, person_id, kind, field, value, source)
       VALUES ($1, $2, $2, 'set', 'canary', $3, $4)`,
      [
        eventId,
        env.CANARY_ORG_SLUG,
        new Date().toISOString(),
        env.CANARY_SOURCE,
      ],
    )
    console.info(JSON.stringify({ msg: 'canary event written', eventId }))
  } finally {
    await client.end()
  }
}
