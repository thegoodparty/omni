// Uploads this build's client source maps to Grafana Frontend Observability,
// which resolves minified stack traces against them privately. Runs as the
// last step of `npm run build`, after `next build` has written .next/static.
//
// The Faro CLI rather than a bundler plugin because the build is Turbopack,
// which the Faro webpack/rollup plugins do not hook into. It deletes each map
// once uploaded, so the deployed output stops serving them publicly.
//
// Never fails the build. Local builds and any environment without the upload
// token skip with a warning, and a failed upload costs readable stack traces
// for one deploy, not the deploy.
import { spawnSync } from 'node:child_process'

// The Grafana Cloud stack id, the same one gp-api/deploy/infra-cli.ts uses.
const GRAFANA_STACK_ID = '1532096'

const required = {
  FARO_SOURCEMAP_API_KEY: process.env.FARO_SOURCEMAP_API_KEY,
  FARO_SOURCEMAP_ENDPOINT: process.env.FARO_SOURCEMAP_ENDPOINT,
  FARO_SOURCEMAP_APP_ID: process.env.FARO_SOURCEMAP_APP_ID,
  // The bundle id. instrumentation-client.ts reports the same value (baked
  // in by next.config.ts), and that is what pairs an error with these maps.
  GITHUB_SHA: process.env.GITHUB_SHA,
}

const missing = Object.entries(required)
  .filter(([, value]) => !value)
  .map(([name]) => name)

if (missing.length > 0) {
  console.warn(
    `Faro source map upload skipped: ${missing.join(', ')} not set. ` +
      'Errors from this build will show minified stack traces in Grafana.',
  )
  process.exit(0)
}

// The API key reaches the CLI as FARO_SOURCEMAP_API_KEY, which it reads from
// the environment, so it never appears in a process listing or a build log.
const result = spawnSync(
  'npx',
  [
    'faro-cli',
    'upload',
    '--endpoint',
    required.FARO_SOURCEMAP_ENDPOINT,
    '--app-id',
    required.FARO_SOURCEMAP_APP_ID,
    '--stack-id',
    GRAFANA_STACK_ID,
    '--bundle-id',
    required.GITHUB_SHA,
    '--app-name',
    'gp-webapp',
    '--output-path',
    '.next/static',
    '--recursive',
    '--gzip-payload',
  ],
  { stdio: 'inherit' },
)

if (result.status !== 0) {
  console.warn(
    '::warning::Faro source map upload failed. Errors from this build will ' +
      'show minified stack traces in Grafana.',
  )
}
