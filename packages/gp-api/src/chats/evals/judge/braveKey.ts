import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import { z } from 'zod'
import { judgeAwsClientConfig } from './awsCredentials'

// THE APP SECRETS A JUDGED AGENT NEEDS, and the arms cannot get them the way
// the deployed app does. judge.yml hands an arm the model key, the Databricks
// pair and the judge role's session credentials, and nothing else: `.env.test`
// is the whole of an arm's environment, and it carries no BRAVE_API_KEY. So a
// judged run of an agent whose tools search the web would answer
// `not_configured` on every call and the sweep would grade a searchless agent.
//
// Read with the judge role's own credentials (awsCredentials.ts) from the dev
// app secret, which is the same blob gp-api dev tasks read and the only place
// the key lives that this job can reach. GP_API_DEV, never PROD: a sweep is a
// dev-grade operation, and the read grant on the pull-request role covers only
// the dev secret.
const SECRET_ID = 'GP_API_DEV'

// The value is never logged, never returned to a caller that could print it,
// and never written to a record: it is installed into this process's
// environment under the name the tool reads, exactly as modelKey.ts installs
// the model key.
export const installBraveKey = async (
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> => installDevSecretKeys(['BRAVE_API_KEY'], env)

// The voter-file identity queryDatabricks reads through
// (PeopleDbxStatementClient), for an in-process agent that queries the
// warehouse: gp-api dev's own principal, so a judged run reads exactly what
// the deployed agent can.
export const PEOPLE_DBX_KEYS = [
  'PEOPLE_DATABRICKS_WAREHOUSE_ID',
  'PEOPLE_DATABRICKS_CLIENT_ID',
  'PEOPLE_DATABRICKS_CLIENT_SECRET',
] as const

export const installPeopleDbxKeys = async (
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> => installDevSecretKeys(PEOPLE_DBX_KEYS, env)

// All or nothing: a half-installed identity is a run that fails on every
// query for a reason nobody can see.
const installDevSecretKeys = async (
  names: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<boolean> => {
  if (names.every((name) => env[name])) return true
  const client = new SecretsManagerClient(judgeAwsClientConfig())
  try {
    const secret = await client.send(
      new GetSecretValueCommand({ SecretId: SECRET_ID }),
    )
    if (!secret.SecretString) return false
    const blob = z
      .record(z.string(), z.unknown())
      .safeParse(JSON.parse(secret.SecretString))
    if (!blob.success) return false
    const values = names.map((name) => blob.data[name])
    const keys = z.array(z.string().min(1)).safeParse(values)
    if (!keys.success) return false
    names.forEach((name, i) => {
      env[name] = keys.data[i]
    })
    return true
  } catch {
    return false
  } finally {
    client.destroy()
  }
}
