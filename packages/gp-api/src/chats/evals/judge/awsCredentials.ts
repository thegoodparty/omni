// THE NAMES THE ROLE'S CREDENTIALS TRAVEL UNDER. The arms once ran under
// vitest, which applies `.env.test` over the process environment, and
// `.env.test` stubs AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY. It does not
// define AWS_SESSION_TOKEN, so the real token survived beside a stub key,
// and AWS answered that the key "does not exist in our records" — which is
// how the first sweep past the queue lookup ended. The names stay so both
// arms read the role's credentials the same way.
export const ARM_AWS_ENV = {
  accessKeyId: 'JUDGE_AWS_ACCESS_KEY_ID',
  secretAccessKey: 'JUDGE_AWS_SECRET_ACCESS_KEY',
  sessionToken: 'JUDGE_AWS_SESSION_TOKEN',
} as const

type ClientCredentials = {
  credentials?: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken?: string
  }
}

// For the judge's own S3 and SQS clients only. The app under test keeps the
// stubs, as it does in every other test run, so nothing it calls can reach
// AWS on the judge's role.
//
// Empty when none are passed, and the SDK's own chain decides: a local run
// that exports nothing gets `.env.test`'s stub and fails the same way, so
// the README says to export these three names to run a background agent.
export const judgeAwsClientConfig = (
  env: NodeJS.ProcessEnv = process.env,
): ClientCredentials => {
  const read = (name: string): string | undefined =>
    env[name] === '' ? undefined : env[name]
  const accessKeyId = read(ARM_AWS_ENV.accessKeyId)
  const secretAccessKey = read(ARM_AWS_ENV.secretAccessKey)
  const sessionToken = read(ARM_AWS_ENV.sessionToken)
  if (
    accessKeyId === undefined &&
    secretAccessKey === undefined &&
    sessionToken === undefined
  ) {
    return {}
  }
  // Half a pair would sign with whatever the chain supplies for the other
  // half, which is the stub: the same failure, and a harder one to read.
  if (accessKeyId === undefined || secretAccessKey === undefined) {
    throw new Error(
      `${ARM_AWS_ENV.accessKeyId} and ${ARM_AWS_ENV.secretAccessKey} must ` +
        'be passed together, or neither',
    )
  }
  return {
    credentials: {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken === undefined ? {} : { sessionToken }),
    },
  }
}
