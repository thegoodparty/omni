import { ENV_VAR_CONTRACT } from './env.schema'

export type EnvVarState =
  | { configured: true; value: string }
  | { configured: false }

// Resolves one ENV_VAR_CONTRACT entry against process.env. Missing (unset or
// empty) or equal to the var's documented `.env.example` placeholder both mean
// "never configured" — the caller degrades its feature instead of throwing at
// import time. Any other value, including one that merely looks
// placeholder-shaped without being declared as this var's sentinel, is real
// and passed through untouched.
export const resolveEnvVar = (name: string): EnvVarState => {
  const spec = ENV_VAR_CONTRACT[name]
  if (!spec) {
    throw new Error(`${name} is not declared in ENV_VAR_CONTRACT`)
  }
  const value = process.env[name]
  if (!value || value === spec.placeholder) {
    return { configured: false }
  }
  return { configured: true, value }
}
