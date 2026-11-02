import { beforeEach, onTestFinished } from 'vitest'

export type AppEnvOverrides = {
  IS_NON_PROD_DEPLOY?: boolean
  VENDOR_MODE?: 'live' | 'mock'
  VENDOR_CRONS_ENABLED?: boolean
  APP_ROOT?: string
  WEBAPP_ROOT?: string
  MAX_RESOLVED_ID_SET_SIZE?: number
}

// The appEnvironment.util constants are evaluated once at import, so a test
// cannot flip them with vi.stubEnv. src/test-app-env-mock.ts mocks the module
// for every shared-modules test file with getters that read this object first
// and fall back to the real value. It is cleared after every test and every file, so set
// what a test needs inside it, or once per file with useAppEnvOverrides.
export const appEnvOverrides: AppEnvOverrides = {}

export const resetAppEnvOverrides = (): void => {
  for (const key of Object.keys(appEnvOverrides)) {
    delete appEnvOverrides[key as keyof AppEnvOverrides]
  }
}

// Applies at once, so whatever the file's beforeAll builds (the app under
// useTestService) sees it, and again before each test after the reset.
export const useAppEnvOverrides = (defaults: AppEnvOverrides): void => {
  Object.assign(appEnvOverrides, defaults)
  beforeEach(() => {
    Object.assign(appEnvOverrides, defaults)
  })
}

// Simulates a non-prod deploy in live mode for the rest of the current test.
export const disableVendorCrons = (): void => {
  appEnvOverrides.VENDOR_CRONS_ENABLED = false
  onTestFinished(() => {
    delete appEnvOverrides.VENDOR_CRONS_ENABLED
  })
}
