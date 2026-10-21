// The gate on this module's dev-only routes (the seed, the mock audio sink):
// write seams that must never be reachable on prod. Same gate as the
// community issues seed: OTEL_SERVICE_ENVIRONMENT names the deploy (NODE_ENV
// is 'production' in every image), an unknown value fails closed, and unset
// means local or vitest. Read live so a test can stub it.
const DEV_ONLY_ENVIRONMENTS = new Set(['local', 'test', 'preview', 'dev'])

export const isDevOnlyRouteEnabled = (): boolean => {
  const env = process.env.OTEL_SERVICE_ENVIRONMENT
  return env === undefined || DEV_ONLY_ENVIRONMENTS.has(env)
}
