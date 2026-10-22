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
//   npx tsx scripts/setup/lib/cli.ts build <pkg> <copiedEnvPath|-> <outPath> \
//       [<underEnvPath>]
//     Merge copied values (or nothing, if `-`), laid over underEnvPath's
//     values when given (an existing .env being refreshed), with <pkg>'s local-only
//     defaults and its .env.example placeholders (buildMergedEnv's
//     precedence), validate the result, and write it to outPath. Exits 1
//     with missing var NAMES on stderr and writes nothing if the merged env
//     still doesn't validate.
//
//   npx tsx scripts/setup/lib/cli.ts device-flow <clientId> <apiUrl> \
//       <outDir> <pkg...>
//     Walk the GitHub OAuth device flow (read:org), then exchange the
//     resulting token for a dev-env bundle for each <pkg>, writing
//     <outDir>/device-<pkg>.env for each. Exits 1, writes nothing, and never
//     prints the token or any vended value if any step fails.
//
//     With ELECTION_SEED_OUT set, also downloads the local election seed to
//     that path on the same token (best-effort: a failure only warns).
//
//   npx tsx scripts/setup/lib/cli.ts election-seed <clientId> <apiUrl> <outPath>
//     Walk the device flow and download the local election seed (the slice
//     of the dev election database `electiondb` is loaded from) to outPath.
//     Exits 1 if no seed was fetched. Never prints the token or the URL.
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
//
//   npx tsx scripts/setup/lib/cli.ts seed-activity --org <slug>
//   npx tsx scripts/setup/lib/cli.ts seed-activity --fixture <userState>
//     [--answers <n>] [--split lean|even]
//     Behind `npm run seed:activity`. Fills a local org with outreach,
//     memos and synthesis, or mints a fresh fixture user that already has
//     them and prints its login. --answers sets how many residents answer
//     a Serve org's seeded priority (all of them by default) and --split
//     even splits those answers half yes, half no. The machine secret comes from the env var
//     above, else from packages/gp-api/.env, where setup writes it.
import { execFileSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import {
  AccessDeniedError,
  awaitAccessToken,
  type DeviceCodeResponse,
  DeviceFlowExpiredError,
  requestDeviceCode,
} from './deviceFlow'
// devEnvBundle pulls in @goodparty_org/contracts, whose dist/ does not
// exist yet when the secrets step runs on a fresh clone (contracts builds
// later in setup.sh). Loaded lazily inside runDeviceFlow so the --from and
// validation paths never touch it — same pattern as the runtime import()
// below.
import {
  buildMergedEnv,
  findPlaceholderFeatures,
  parseEnvFile,
  serializeBuiltEnv,
  serializeEnvFile,
  type EnvMap,
} from './env'
import {
  runSeedActivity,
  runSeedLogin,
  type SeedPriorityOptions,
} from './seedLogin'

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
      // Clerk rejects any session token whose azp isn't listed, so the
      // .env.example placeholder would 401 every request from the local
      // webapp.
      CLERK_AUTHORIZED_PARTIES: 'http://localhost:4000',
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
  import(pathToFileURL(resolve(REPO_ROOT, pkg.schemaPath)).href)

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

export const runBuild = async (
  pkgName: string,
  copiedEnvPath: string,
  outPath: string,
  underEnvPath?: string,
) => {
  const pkg = PACKAGES[pkgName] ?? fail(`unknown package "${pkgName}"`)
  const { envSchema, ENV_VAR_CONTRACT } = await loadSchemaModule(pkg)

  const copied = {
    ...(underEnvPath ? readEnvFile(underEnvPath) : {}),
    ...(copiedEnvPath === '-' ? {} : readEnvFile(copiedEnvPath)),
  }
  const placeholder = readEnvFile(join(REPO_ROOT, pkg.envExamplePath))
  const keys = Object.keys(ENV_VAR_CONTRACT)
  const merged = buildMergedEnv(keys, copied, pkg.localOnly, placeholder)

  const result = envSchema.safeParse(merged)
  if (!result.success) {
    console.error(`Could not build a valid env for "${pkgName}", missing:`)
    printMissing(result, ENV_VAR_CONTRACT)
    process.exit(1)
  }

  writeFileSync(outPath, serializeBuiltEnv(merged, keys))

  const dark = findPlaceholderFeatures(ENV_VAR_CONTRACT, merged)
  if (dark.length > 0) {
    console.error(
      `${pkgName}: these features stay off until their key is set ` +
        `(ask an admin to add it to LOCAL_DEV_ENV, see docs/secrets.md, ` +
        `then run npm run setup -- --secrets-only --refresh):`,
    )
    for (const line of dark) console.error(`  - ${line}`)
  }
  process.exit(0)
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

// get-var's varName arg is always a non-secret path/name string, never a
// value.
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

const parseSeedPriorityOptions = (
  args: string[],
): SeedPriorityOptions | null => {
  const options: SeedPriorityOptions = {}
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]
    const value = args[i + 1]
    if (flag === '--answers' && value !== undefined && /^\d+$/.test(value)) {
      options.answers = Number(value)
    } else if (flag === '--split' && (value === 'lean' || value === 'even')) {
      options.split = value
    } else {
      return null
    }
  }
  return options
}

const runSeedActivityCommand = async (
  flag: string,
  value: string,
  options: SeedPriorityOptions,
) => {
  const machineSecret =
    process.env.LOCAL_SETUP_CLERK_MACHINE_SECRET ||
    (readEnvFile(resolve(REPO_ROOT, 'packages/gp-api/.env'))
      .LOCAL_SETUP_CLERK_MACHINE_SECRET ??
      '')
  if (flag === '--org') {
    const result = await runSeedActivity(machineSecret, value, fetch, options)
    if (result.kind !== 'seeded') {
      return fail(`Seeding ${value} ${result.kind}: ${result.reason}`)
    }
    process.stdout.write(
      `Seeded ${value}: ${result.efforts} efforts, ${result.memos} memos ` +
        `across ${result.people} people. Synthesis is running.\n`,
    )
    return
  }
  const result = await runSeedLogin(machineSecret, value, fetch, true, options)
  if (result.kind !== 'minted') {
    return fail(`Seeded fixture ${result.kind}: ${result.reason}`)
  }
  // Same rule as setup.sh's login step: credentials only ever reach a
  // terminal, never a redirected file or a CI log.
  process.stdout.write(
    process.stdout.isTTY
      ? [
          `Seeded ${value} fixture ${result.orgSlug ?? ''}`,
          '  url       http://localhost:4000',
          `  email     ${result.email}`,
          `  password  ${result.password}`,
          '',
        ].join('\n')
      : `Seeded ${value} fixture (credentials suppressed, non-interactive)\n`,
  )
}

// Best-effort only: a headless runner, a Linux box, or a sandboxed `open`
// must never fail the flow — the human can still follow the printed URL.
const tryOpen = (uri: string): void => {
  if (process.platform !== 'darwin') return
  try {
    execFileSync('open', [uri], { stdio: 'ignore' })
  } catch {
    // best-effort
  }
}

// Walks the GitHub OAuth device flow (read:org) and returns the user token,
// or exits through fail(). The token is only ever handed to gp-api's
// dev-env routes and is never printed or persisted.
const acquireGithubToken = async (clientId: string): Promise<string> => {
  if (!clientId) {
    return fail(
      'GitHub OAuth App not registered yet — use --from <path>, or see ' +
        "the epic's ops prerequisites.",
    )
  }

  let device: DeviceCodeResponse
  try {
    device = await requestDeviceCode(clientId)
  } catch (err) {
    return fail(
      `Could not start the GitHub device flow: ${(err as Error).message}`,
    )
  }

  console.log(`First, visit: ${device.verification_uri}`)
  console.log(`Then enter this code: ${device.user_code}`)
  tryOpen(device.verification_uri)
  console.log('Waiting for you to authorize in the browser...')

  try {
    return await awaitAccessToken(clientId, device, { sleep })
  } catch (err) {
    if (err instanceof DeviceFlowExpiredError) {
      return fail(
        'The device code expired before it was authorized. Re-run setup to get a new one.',
      )
    }
    if (err instanceof AccessDeniedError) {
      return fail('GitHub authorization was denied.')
    }
    return fail(`GitHub device flow failed: ${(err as Error).message}`)
  }
}

// Fetches the local election seed into outPath. Never fatal on the device
// flow path: a missing seed costs local election data, not the rest of setup,
// and scripts/setup/election-db.sh says how to fetch it later.
const fetchElectionSeed = async (
  apiUrl: string,
  token: string,
  outPath: string,
): Promise<boolean> => {
  try {
    const { fetchElectionSeedUrl, downloadElectionSeed } =
      await import('./devEnvBundle')
    const url = await fetchElectionSeedUrl(apiUrl, token)
    await downloadElectionSeed(url, outPath)
    console.log('Fetched the local election seed')
    return true
  } catch (err) {
    console.warn(
      `Could not fetch the local election seed: ${(err as Error).message}`,
    )
    return false
  }
}

export const runElectionSeedFetch = async (
  clientId: string,
  apiUrl: string,
  outPath: string,
) => {
  let token = await acquireGithubToken(clientId)
  try {
    if (!(await fetchElectionSeed(apiUrl, token, outPath))) {
      fail('No local election seed was fetched.')
    }
  } finally {
    token = ''
  }
}

export const runDeviceFlow = async (
  clientId: string,
  apiUrl: string,
  outDir: string,
  packages: string[],
) => {
  let token = await acquireGithubToken(clientId)

  try {
    const { fetchDevEnvBundles } = await import('./devEnvBundle')
    const bundles = await fetchDevEnvBundles(apiUrl, token, packages)

    // Validate every bundle against what was actually requested BEFORE
    // writing any of them ("no partial writes", same invariant setup.sh's
    // own build_one keeps). The schema already constrains `package` to a
    // known enum; this additionally refuses a schema-valid package the
    // caller never asked for.
    const unexpected = bundles.filter((b) => !packages.includes(b.package))
    if (unexpected.length > 0) {
      return fail(
        `${apiUrl} returned bundle(s) for unrequested package(s): ` +
          `${unexpected.map((b) => b.package).join(', ')}.`,
      )
    }
    // ...and the mirror check: a partial response would otherwise leave a
    // requested device-<pkg>.env unwritten and let build_one fall through
    // to a stale file or placeholders without naming the real cause.
    const returned = new Set<string>(bundles.map((b) => b.package))
    const missing = packages.filter((pkg) => !returned.has(pkg))
    if (missing.length > 0) {
      return fail(
        `${apiUrl} returned no bundle for requested package(s): ` +
          `${missing.join(', ')}.`,
      )
    }

    for (const bundle of bundles) {
      writeFileSync(
        join(outDir, `device-${bundle.package}.env`),
        serializeEnvFile(bundle.variables, Object.keys(bundle.variables)),
      )
    }
    console.log(`Fetched dev env bundle for: ${packages.join(', ')}`)

    // Rides along on the same token so setup never prompts twice. Set by
    // setup.sh; absent when a caller only wants the env bundles.
    const seedOut = process.env.ELECTION_SEED_OUT
    if (seedOut) {
      await fetchElectionSeed(apiUrl, token, seedOut)
    }
  } catch (err) {
    return fail(`Could not fetch dev env bundles: ${(err as Error).message}`)
  } finally {
    // No caching, by design — never let the token outlive this call.
    token = ''
  }
}

const main = async () => {
  const argv = process.argv.slice(2)
  const [command] = argv

  if (command === 'check' && argv[1] && argv[2]) {
    await runCheck(argv[1], argv[2])
    return
  }
  if (command === 'build' && argv[1] && argv[2] && argv[3]) {
    await runBuild(argv[1], argv[2], argv[3], argv[4])
    return
  }
  // clientId (argv[1]) may legitimately be the empty string — that's the
  // unregistered-OAuth-App state runDeviceFlow itself fails closed on — so
  // this checks presence, not truthiness, unlike check/build above.
  if (
    command === 'device-flow' &&
    argv[1] !== undefined &&
    argv[2] !== undefined &&
    argv[3] !== undefined &&
    argv.length > 4
  ) {
    await runDeviceFlow(argv[1], argv[2], argv[3], argv.slice(4))
    return
  }
  if (
    command === 'election-seed' &&
    argv[1] !== undefined &&
    argv[2] !== undefined &&
    argv[3]
  ) {
    await runElectionSeedFetch(argv[1], argv[2], argv[3])
    return
  }
  if (command === 'get-var' && argv[1] && argv[2]) {
    runGetVar(argv[1], argv[2])
    return
  }
  // The machine secret arrives via the environment, never argv — argv is
  // world-readable on shared machines (ps / /proc/PID/cmdline). Empty or
  // unset is the legitimate skip path.
  if (command === 'seed-login' && argv[1] !== undefined) {
    await runSeedLoginCommand(
      process.env.LOCAL_SETUP_CLERK_MACHINE_SECRET ?? '',
      argv[1],
    )
    return
  }
  if (
    command === 'seed-activity' &&
    (argv[1] === '--org' || argv[1] === '--fixture') &&
    argv[2]
  ) {
    const options = parseSeedPriorityOptions(argv.slice(3))
    if (options !== null) {
      await runSeedActivityCommand(argv[1], argv[2], options)
      return
    }
  }

  fail(
    [
      'Usage:',
      '  cli.ts check <pkg> <envFilePath>',
      '  cli.ts build <pkg> <copiedEnvPath|-> <outPath> [<underEnvPath>]',
      '  cli.ts device-flow <clientId> <apiUrl> <outDir> <pkg...>',
      '  cli.ts election-seed <clientId> <apiUrl> <outPath>',
      '  cli.ts get-var <envFilePath> <varName>',
      '  cli.ts seed-login <userState>   (secret via env var',
      '    LOCAL_SETUP_CLERK_MACHINE_SECRET; empty/unset = skip)',
      '  cli.ts seed-activity --org <slug> | --fixture <userState>',
      '    [--answers <n>] [--split lean|even]',
    ].join('\n'),
  )
}

// Guarded so importing this module (cli.test.ts, testing runDeviceFlow)
// never also runs main() against the test runner's own argv/exit.
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error: Error) => {
    console.error(error.message)
    process.exit(1)
  })
}
