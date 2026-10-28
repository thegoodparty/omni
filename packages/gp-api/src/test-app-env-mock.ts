import { afterAll, afterEach, vi } from 'vitest'
import { resetAppEnvOverrides } from '@/shared/test-utils/appEnvOverrides'

// One mock for every shared-modules test file, so a file that needs a different deploy env
// sets appEnvOverrides instead of calling vi.mock, which would move it to the
// slower fresh-modules project (see vitest.config.ts).
vi.mock('@/shared/util/appEnvironment.util', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/shared/util/appEnvironment.util')>()
  const { appEnvOverrides } =
    await import('@/shared/test-utils/appEnvOverrides.js')
  return {
    ...actual,
    get IS_NON_PROD_DEPLOY() {
      return appEnvOverrides.IS_NON_PROD_DEPLOY ?? actual.IS_NON_PROD_DEPLOY
    },
    get VENDOR_MODE() {
      return appEnvOverrides.VENDOR_MODE ?? actual.VENDOR_MODE
    },
    get VENDOR_CRONS_ENABLED() {
      return appEnvOverrides.VENDOR_CRONS_ENABLED ?? actual.VENDOR_CRONS_ENABLED
    },
    get APP_ROOT() {
      return appEnvOverrides.APP_ROOT ?? actual.APP_ROOT
    },
    get WEBAPP_ROOT() {
      return appEnvOverrides.WEBAPP_ROOT ?? actual.WEBAPP_ROOT
    },
  }
})

afterEach(() => {
  resetAppEnvOverrides()
})

afterAll(() => {
  resetAppEnvOverrides()
})
