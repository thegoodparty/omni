// Bash-callable helper (via `npx tsx`) behind `scripts/setup.sh`'s secrets
// step. Bash never re-implements the env schema — it shells out here so the
// check against `envSchema` (Zod) is the same one CI and the app itself trust.
//
// Usage:
//   npx tsx scripts/setup/lib/cli.ts check <pkg> <envFilePath>
//     Exit 0 if envFilePath exists and validates against <pkg>'s schema.
//     Exit 1 with the failing/missing var NAMES on stderr otherwise (never
//     values — this is the one place in the setup flow that touches real
//     secrets, so it must not become the one place that leaks one).
//
//   npx tsx scripts/setup/lib/cli.ts build <pkg> <copiedEnvPath|-> <outPath>
//     Merge copied values (or nothing, if `-`) with <pkg>'s local-only
//     defaults and its .env.example placeholders (buildMergedEnv's
//     precedence), validate the result, and write it to outPath. Exits 1
//     with missing var NAMES on stderr and writes nothing if the merged env
//     still doesn't validate.
//
//   npx tsx scripts/setup/lib/cli.ts get-var <envFilePath> <varName>
//     Print <varName>'s parsed value from <envFilePath> (empty line if the
//     file or the var is absent). Reuses parseEnvFile so bash never
//     re-implements dotenv quoting for the one var (machine secrets) it
//     needs to read back out of a written env file.
//
//   npx tsx scripts/setup/lib/cli.ts seed-login <userState>
//     Mint a per-run Clerk M2M token with the secret read from the
//     LOCAL_SETUP_CLERK_MACHINE_SECRET env var (never argv — argv is
//     visible in ps; empty/unset takes the skip path) and use it to
//     mint a QA fixture user in <userState> via
//     gp-api's test-fixtures endpoint. Prints exactly one tab-separated
//     result line to stdout — 'OK\t<email>\t<password>',
//     'FAILED\t<reason>', or 'SKIPPED\t<reason>' — and always exits 0; the
//     caller (setup.sh) decides how to react. Never writes anything else to
//     stdout/stderr, so a credential can only ever reach the one line a
//     caller explicitly captures.
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  buildMergedEnv,
  parseEnvFile,
  serializeEnvFile,
  type EnvMap,
} from './env'
import { runSeedLogin } from './seedLogin'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

type EnvVarSpec = {
  tier: 'required' | 'degradable' | 'optional'
  feature?: string
  placeholder?: string
  default?: string
}

// The zod schema's safeParse result shape we actually read — narrow rather
// than importing zod's own types, since the schema module is loaded via a
// runtime `import()` of a path that isn't known until argv is parsed.
type SafeParseResult =
  | { success: true }
  | { success: false; error: { issues: { path: (string | number)[] }[] } }

type SchemaModule = {
  envSchema: { safeParse: (data: EnvMap) => SafeParseResult }
  ENV_VAR_CONTRACT: Record<string, EnvVarSpec>
}

type PackageConfig = {
  schemaPath: string
  envExamplePath: string
  // Values scripts/setup.sh owns outright — never copied from a source
  // checkout, always this repo's local stack. See scripts/setup.sh's header
  // comment for why each one is here.
  localOnly: EnvMap
}

const PACKAGES: Record<string, PackageConfig> = {
  'gp-api': {
    schemaPath: 'packages/gp-api/src/shared/env/env.schema.ts',
    envExamplePath: 'packages/gp-api/.env.example',
    localOnly: {
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/gpdb',
      CORS_ORIGIN: 'http://localhost:4000',
      WEBAPP_ROOT_URL: 'http://localhost:4000',
      OTEL_SERVICE_ENVIRONMENT: 'dev',
      // Mirrors deploy/index.ts's preview-disable pattern: these queues
      // don't exist for a local stack, and both vars degrade gracefully
      // when empty (agentExperiments/AGENTS.md).
      AGENT_DISPATCH_QUEUE_NAME: '',
      CAMPAIGN_PLAN_INPUT_QUEUE_URL: '',
    },
  },
  'gp-webapp': {
    schemaPath: 'packages/gp-webapp/env.schema.ts',
    envExamplePath: 'packages/gp-webapp/.env.example',
    // gp-webapp's own `dev` npm script (which scripts/dev.sh calls) already
    // pins NEXT_PUBLIC_API_BASE to http://localhost:3000 via cross-env, so
    // there's nothing this script needs to own here.
    localOnly: {},
  },
}

const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

const loadSchemaModule = async (pkg: PackageConfig): Promise<SchemaModule> =>
  import(resolve(REPO_ROOT, pkg.schemaPath))

const printMissing = (
  result: Extract<SafeParseResult, { success: false }>,
  contract: Record<string, EnvVarSpec>,
): void => {
  const names = [...new Set(result.error.issues.map((issue) => issue.path[0]))]
  for (const name of names) {
    const tier = typeof name === 'string' ? contract[name]?.tier : undefined
    console.error(`  - ${String(name)}${tier ? ` (${tier})` : ''}`)
  }
}

const readEnvFile = (path: string): EnvMap =>
  existsSync(path) ? parseEnvFile(readFileSync(path, 'utf-8')) : {}

const runCheck = async (pkgName: string, envFilePath: string) => {
  const pkg = PACKAGES[pkgName] ?? fail(`unknown package "${pkgName}"`)
  if (!existsSync(envFilePath)) process.exit(1)

  const { envSchema, ENV_VAR_CONTRACT } = await loadSchemaModule(pkg)
  const parsed = parseEnvFile(readFileSync(envFilePath, 'utf-8'))
  const result = envSchema.safeParse(parsed)
  if (!result.success) {
    console.error(`${envFilePath} fails schema validation, missing/invalid:`)
    printMissing(result, ENV_VAR_CONTRACT)
    process.exit(1)
  }
  process.exit(0)
}

const runBuild = async (
  pkgName: string,
  copiedEnvPath: string,
  outPath: string,
) => {
  const pkg = PACKAGES[pkgName] ?? fail(`unknown package "${pkgName}"`)
  const { envSchema, ENV_VAR_CONTRACT } = await loadSchemaModule(pkg)

  const copied = copiedEnvPath === '-' ? {} : readEnvFile(copiedEnvPath)
  const placeholder = readEnvFile(join(REPO_ROOT, pkg.envExamplePath))
  const keys = Object.keys(ENV_VAR_CONTRACT)
  const merged = buildMergedEnv(keys, copied, pkg.localOnly, placeholder)

  const result = envSchema.safeParse(merged)
  if (!result.success) {
    console.error(`Could not build a valid env for "${pkgName}", missing:`)
    printMissing(result, ENV_VAR_CONTRACT)
    process.exit(1)
  }

  writeFileSync(outPath, serializeEnvFile(merged, keys))
  process.exit(0)
}

// get-var's varName arg reuses the destructured `a` name below; both
// arguments are always non-secret path/name strings, never values.
const runGetVar = (envFilePath: string, varName: string) => {
  const parsed = readEnvFile(envFilePath)
  process.stdout.write(`${parsed[varName] ?? ''}\n`)
}

const runSeedLoginCommand = async (
  machineSecret: string,
  userState: string,
) => {
  const result = await runSeedLogin(machineSecret, userState)
  if (result.kind === 'minted') {
    process.stdout.write(`OK\t${result.email}\t${result.password}\n`)
  } else {
    process.stdout.write(`${result.kind.toUpperCase()}\t${result.reason}\n`)
  }
}

const main = async () => {
  const [command, pkgName, a, b] = process.argv.slice(2)

  if (command === 'check' && pkgName && a) {
    await runCheck(pkgName, a)
    return
  }
  if (command === 'build' && pkgName && a && b) {
    await runBuild(pkgName, a, b)
    return
  }
  if (command === 'get-var' && pkgName && a) {
    runGetVar(pkgName, a)
    return
  }
  // The machine secret arrives via the environment, never argv — argv is
  // world-readable on shared machines (ps / /proc/PID/cmdline). Empty or
  // unset is the legitimate skip path.
  if (command === 'seed-login' && pkgName !== undefined) {
    await runSeedLoginCommand(
      process.env.LOCAL_SETUP_CLERK_MACHINE_SECRET ?? '',
      pkgName,
    )
    return
  }

  fail(
    [
      'Usage:',
      '  cli.ts check <pkg> <envFilePath>',
      '  cli.ts build <pkg> <copiedEnvPath|-> <outPath>',
      '  cli.ts get-var <envFilePath> <varName>',
      '  cli.ts seed-login <userState>   (secret via env var',
      '    LOCAL_SETUP_CLERK_MACHINE_SECRET; empty/unset = skip)',
    ].join('\n'),
  )
}

main().catch((error: Error) => {
  console.error(error.message)
  process.exit(1)
})
