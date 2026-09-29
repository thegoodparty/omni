import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

// otel.ts is preloaded with `node -r`, so Node's CJS resolution -- not vite's
// -- is what decides which copy of the logs API each participant loads.
const nodeRequire = createRequire(__filename)

const gpApiSrc = join(__dirname, '../..')

const packageDir = (specifier: string, from: string) => {
  let dir = dirname(nodeRequire.resolve(specifier, { paths: [from] }))
  while (!existsSync(join(dir, 'package.json'))) dir = dirname(dir)
  return dir
}

const apiLogsFrom = (from: string) =>
  nodeRequire.resolve('@opentelemetry/api-logs', { paths: [from] })

// Everything that reads the global provider does so through its own
// InstrumentationBase, so the copy that matters is the one resolved from that
// base, not from the plugin package.
const instrumentationHosts = [
  '@opentelemetry/instrumentation-pino',
  '@opentelemetry/instrumentation-http',
  '@opentelemetry/instrumentation-nestjs-core',
  '@opentelemetry/instrumentation-runtime-node',
  '@opentelemetry/sdk-node',
  '@prisma/instrumentation',
  '@fastify/otel',
]

const readers = new Map<string, string[]>()
const addReader = (path: string, importer: string) => {
  const existing = readers.get(path)
  if (existing) existing.push(importer)
  else readers.set(path, [importer])
}

addReader(
  apiLogsFrom(packageDir('@opentelemetry/sdk-logs', gpApiSrc)),
  'sdk-logs',
)
for (const host of instrumentationHosts) {
  const base = packageDir(
    '@opentelemetry/instrumentation',
    packageDir(host, gpApiSrc),
  )
  addReader(apiLogsFrom(base), host)
}

type LoggerProviderLike = { getLogger: () => object }
type LogsApi = {
  logs: {
    disable: () => void
    getLoggerProvider: () => LoggerProviderLike
    setGlobalLoggerProvider: (
      provider: LoggerProviderLike,
    ) => LoggerProviderLike
  }
}

const loadLogsApi = (path: string) => nodeRequire(path) as LogsApi

describe('@opentelemetry/api-logs global registry', () => {
  // Not a tautology. The setter and every reader are on DIFFERENT copies:
  // `npm ci` resolves 0.52.1 for otel.ts, the hoisted 0.218.0 for sdk-logs and
  // pino/http/nest/sdk-node, 0.207.0 under @prisma/instrumentation and 0.208.0
  // under @fastify/otel. The production image has the same split — its
  // `npm ci --omit=dev` reads this lockfile and the 0.52.1 entry is not
  // dev-flagged.
  //
  // Why the split exists: gp-api declares `@opentelemetry/api-logs: ^0.218.0`,
  // but its devDependency `@pulumi/pulumi` pulls
  // `@opentelemetry/instrumentation@0.52.1`, which hard-pins api-logs 0.52.1.
  // npm parks that copy at `packages/gp-api/node_modules/`, where Node's
  // nearest-wins resolution makes it shadow the hoisted 0.218.0 for every file
  // under `src/` — including otel.ts. So otel.ts imports a version its own
  // package.json forbids, and no npm command fixes it in place: `npm install
  // @opentelemetry/api-logs@^0.218.0 -w packages/gp-api` is a verified no-op,
  // because npm considers the range already satisfied by the root hoist. The
  // real fix is dropping Pulumi's ancient OTel out of the app's tree; that is
  // a dependency cleanup of its own, not a line in an alerting change.
  //
  // It is harmless only because all four copies key the provider off the same
  // Symbol.for('io.opentelemetry.js.api.logs') on globalThis under the same
  // API_BACKWARDS_COMPATIBILITY_VERSION (1, checked in all four). One bump of
  // that constant splits the registry, and this test was confirmed to catch it
  // — patching the 0.52.1 copy to version 2 fails it with pino reading back
  // NoopLoggerProvider, which in production is gp-api shipping no logs at all,
  // silently, with every Loki-backed route alert going blind at once.
  it('hands every instrumentation the provider otel.ts registered', () => {
    const setter = loadLogsApi(apiLogsFrom(gpApiSrc))
    const sentinel: LoggerProviderLike = { getLogger: () => ({}) }

    setter.logs.disable()
    try {
      expect(setter.logs.setGlobalLoggerProvider(sentinel)).toBe(sentinel)

      for (const [path, importers] of readers) {
        expect(
          loadLogsApi(path).logs.getLoggerProvider(),
          `${importers.join(', ')} resolved ${path}`,
        ).toBe(sentinel)
      }
    } finally {
      setter.logs.disable()
    }
  })
})
