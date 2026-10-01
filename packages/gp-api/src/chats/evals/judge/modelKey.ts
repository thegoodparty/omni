import { SPEND_ENV, spendsRealMoney } from './config'

// THE NAME THE REAL KEY TRAVELS UNDER, and it cannot be ANTHROPIC_API_KEY.
// vitest.config.ts sets `test.env` from `.env.test`, which defines
// ANTHROPIC_API_KEY as the stub `test-anthropic-key` — and `test.env` is
// applied OVER the process environment, so a workflow that exports the real
// key under that name watches it get replaced by the stub before the first
// test line runs. Every call then comes back `invalid x-api-key`, which is
// what the first live sweep did. A name `.env.test` does not define survives.
export const ARM_KEY_ENV = 'JUDGE_ANTHROPIC_API_KEY'

export const KEY_ENV = 'ANTHROPIC_API_KEY'

// Puts the real key where LlmService looks, for a spending arm only.
//
// MUST BE CALLED AT MODULE SCOPE, before `useTestService()`'s beforeAll boots
// the Nest app: LlmService reads the key when it is constructed, and by the
// time a test body runs the app is already holding the stub.
//
// Gated on JUDGE_SPEND so a dry run keeps the stub. That is the safety
// property, not an optimisation: the canned path cannot reach the real API
// even if the key is sitting in the environment.
export const restoreRealModelKey = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => {
  if (!spendsRealMoney(env)) return false
  const passed = env[ARM_KEY_ENV]
  if (passed === undefined || passed === '') {
    throw new Error(
      `This arm spends (${SPEND_ENV}=true) but ${ARM_KEY_ENV} is not set, ` +
        `so it would run against the ${KEY_ENV} stub in .env.test and every ` +
        'call would fail authentication. The workflow passes the real key ' +
        `under ${ARM_KEY_ENV}; locally, export it from your own .env.`,
    )
  }
  env[KEY_ENV] = passed
  return true
}
