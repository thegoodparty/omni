// Pure helpers behind `scripts/setup.sh`'s "write/complete .env files" step.
// No fs/process access here on purpose — keeps this unit-testable without a
// filesystem, and keeps the merge precedence rule (copied > local-only >
// placeholder) in one place instead of re-decided inline in cli.ts.

export type EnvMap = Record<string, string>

// KEY=value, KEY=, and KEY="quoted value" — comments and blank lines ignored.
// Mirrors packages/gp-api/scripts/check-env-contract.ts's parseEnvExample;
// duplicated rather than imported because that one lives inside a package
// workspace (its own tsconfig/module resolution) and this runs standalone at
// the repo root via a bare `tsx` invocation.
export const parseEnvFile = (contents: string): EnvMap => {
  const result: EnvMap = {}
  for (const line of contents.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const match = /^([A-Z0-9_]+)=(.*)$/.exec(trimmed)
    const key = match?.[1]
    const rawValue = match?.[2]
    if (!key || rawValue === undefined) continue

    // dotenv semantics: quotes preserve everything inside (# included);
    // an unquoted value ends at the first whitespace-preceded # (inline
    // comment), e.g. `TRACK_MAILGUN_EMAILS=false # prod only` -> "false".
    const quoted = /^"(.*)"(?:\s+#.*)?$/.exec(rawValue)
    result[key] = quoted?.[1] ?? rawValue.replace(/\s+#.*$/, '').trim()
  }
  return result
}

// One KEY=value per line, in `keys` order (the schema's declared order) so
// the written file reads like the schema and diffs stay stable across runs.
export const serializeEnvFile = (env: EnvMap, keys: string[]): string =>
  keys.map((key) => `${key}=${env[key] ?? ''}`).join('\n') + '\n'

// Merge precedence: copied value > local-only default > placeholder, decided
// by which layer HAS the key, not by truthiness — an intentionally-empty
// copied or local-only value (e.g. cli.ts's queue-name defaults, left unset
// by design) must win over a non-empty .env.example placeholder, not be
// treated as absent. `keys` bounds the output to exactly the vars the schema
// declares — a stray var in `copied` or `placeholder` that the schema
// doesn't know about is dropped rather than carried forward.
export const buildMergedEnv = (
  keys: string[],
  copied: EnvMap,
  localOnly: EnvMap,
  placeholder: EnvMap,
): EnvMap => {
  const merged: EnvMap = {}
  for (const key of keys) {
    if (key in copied) merged[key] = copied[key]
    else if (key in localOnly) merged[key] = localOnly[key]
    else merged[key] = placeholder[key] ?? ''
  }
  return merged
}
