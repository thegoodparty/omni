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

    // dotenv semantics: quotes (single or double) preserve everything
    // inside (# included); an unquoted value ends at the first
    // whitespace-preceded # (inline comment), e.g.
    // `TRACK_MAILGUN_EMAILS=false # prod only` -> "false".
    const quoted = /^"(.*)"(?:\s+#.*)?$/.exec(rawValue)
    const singleQuoted = /^'(.*)'(?:\s+#.*)?$/.exec(rawValue)
    result[key] =
      quoted?.[1] ?? singleQuoted?.[1] ?? rawValue.replace(/\s+#.*$/, '').trim()
  }
  return result
}

// One KEY=value per line, in `keys` order (the schema's declared order) so
// the written file reads like the schema and diffs stay stable across runs.
export const serializeEnvFile = (env: EnvMap, keys: string[]): string =>
  keys.map((key) => `${key}=${env[key] ?? ''}`).join('\n') + '\n'

// The built .env leaves blank keys out instead of writing KEY=. gp-api reads
// tunables as Number(process.env.X ?? default), and '' slips past ?? to 0,
// zeroing cooldowns and timeouts. device-<pkg>.env keeps its blanks, since
// there an empty value is an admin's deliberate override of a placeholder.
export const serializeBuiltEnv = (env: EnvMap, keys: string[]): string =>
  serializeEnvFile(
    env,
    keys.filter((key) => (env[key] ?? '') !== ''),
  )

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

type PlaceholderSpec = { tier: string; feature?: string; placeholder?: string }

// Only vars that declare a `placeholder` are checked: those are the ones whose
// .env.example value boots cleanly and then fails at first use. The rest of
// the degradable tier (Slack channels, Peerly) is expected to stay dark on a
// laptop, and listing it would bury the one line that matters.
export const findPlaceholderFeatures = (
  contract: Record<string, PlaceholderSpec>,
  env: EnvMap,
): string[] =>
  Object.entries(contract)
    .filter(
      ([name, spec]) =>
        spec.tier === 'degradable' &&
        spec.placeholder !== undefined &&
        (!env[name] || env[name] === spec.placeholder),
    )
    .map(([name, spec]) => `${spec.feature} (${name})`)
