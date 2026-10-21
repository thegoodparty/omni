import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import { Client } from 'pg'
import { z } from 'zod'

// Updates one replication_canary row a minute so the consumer can prove the
// whole path (slot, DMS, Kinesis, Lambda, Zerobus) is moving. DMS can report
// RUNNING while delivering nothing; without a steady write an idle database
// and a stalled pipeline look the same.

const env = z
  .object({
    DB_HOST: z.string().min(1),
    DB_NAME: z.string().min(1),
    DB_SECRET_ARN: z.string().min(1),
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
    const { rows } = await client.query<{ written_at: Date }>(
      `INSERT INTO replication_canary (id, written_at) VALUES (1, now())
       ON CONFLICT (id) DO UPDATE SET written_at = excluded.written_at
       RETURNING written_at`,
    )
    console.info(
      JSON.stringify({
        msg: 'canary written',
        writtenAt: rows[0]?.written_at.toISOString(),
      }),
    )
  } finally {
    await client.end()
  }
}
