import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import { judgeAwsClientConfig } from './awsCredentials'

// THE ONE APP SECRET A JUDGED AGENT NEEDS, and the arms cannot get it the way
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
): Promise<boolean> => {
  if (env.BRAVE_API_KEY) return true
  const client = new SecretsManagerClient(judgeAwsClientConfig())
  try {
    const secret = await client.send(
      new GetSecretValueCommand({ SecretId: SECRET_ID }),
    )
    if (!secret.SecretString) return false
    const parsed: unknown = JSON.parse(secret.SecretString)
    const key =
      typeof parsed === 'object' && parsed !== null && 'BRAVE_API_KEY' in parsed
        ? parsed.BRAVE_API_KEY
        : undefined
    if (typeof key !== 'string' || key === '') return false
    env.BRAVE_API_KEY = key
    return true
  } catch {
    return false
  } finally {
    client.destroy()
  }
}
