import { config as loadEnv } from 'dotenv'
import path from 'node:path'

// A real Anthropic key always starts with this. `.env.test`, which vitest
// auto-loads, sets a stub ("test-anthropic-key"), so the prefix is an exact
// test for "is this a usable key" rather than a heuristic on length.
const REAL_KEY_PREFIX = 'sk-ant-'

const defaultEnvPath = (): string => path.resolve(process.cwd(), '.env')

// Eval tests need a real key, and by the time they run vitest has already
// replaced the environment with `.env.test`'s stubs.
//
// `.env` is still loaded unconditionally, because it carries every other
// credential an eval might want and it is simply absent in CI. What changes
// is that a real key already in the environment survives it.
//
// THAT ONLY HELPS A PROCESS VITEST DID NOT START. `vitest.config.ts` sets
// `test.env` from `.env.test`, and the worker's environment is built as
// `{...process.env, ...test.env}` — so inside any vitest run the stub has
// already replaced a repo secret exported under this name, `hadRealKey` is
// false, and there is nothing here to preserve. A key supplied by the
// environment survives for `npx tsx` only. The judge's arms are vitest and
// do not call this at all: they take the real key under a name `.env.test`
// does not define, which is what `judge/modelKey.ts` exists for.
//
// Returning early instead — "if the env has a key, skip the file" — looks
// equivalent and is not. A developer with ANTHROPIC_API_KEY exported in
// their shell would then never load `.env` at all and would silently lose
// their Databricks config to the stubs.
//
// `envPath` is injectable so the precedence rule can be tested against a
// real file instead of against whatever the developer happens to have.
export const overrideEnvForEvals = (
  envPath: string = defaultEnvPath(),
): void => {
  const envKey = process.env.ANTHROPIC_API_KEY
  const hadRealKey = envKey?.startsWith(REAL_KEY_PREFIX) === true

  loadEnv({ path: envPath, override: true })

  if (hadRealKey) process.env.ANTHROPIC_API_KEY = envKey
}
