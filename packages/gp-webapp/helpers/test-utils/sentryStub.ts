// Stands in for @sentry/nextjs under vitest (see vitest.config.ts). Nothing
// initializes Sentry in a test, so the real SDK's calls are no-ops too; loading
// it cost ~250ms per test file that reached app/shared/sentry.tsx.
export const captureException = (): string => ''
export const setTag = (): void => undefined
export const setUser = (): void => undefined
export const getReplay = (): undefined => undefined
