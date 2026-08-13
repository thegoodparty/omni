import { describe, expect, it } from 'vitest'

import { APP_ROOT, resolveAppRoot } from './appEnvironment.util'

const LOCAL_URL = 'http://localhost:4000'
const DEV_WEBAPP_URL = 'https://dev.goodparty.org'
// In prod WEBAPP_ROOT_URL is the marketing origin (app routes 404 there).
const PROD_MARKETING_URL = 'https://goodparty.org'
// Canonical prod app origin APP_ROOT must resolve to.
const PROD_APP_URL = 'https://app.goodparty.org'

describe('resolveAppRoot', () => {
  it('uses APP_ROOT_URL when set (explicit override wins on non-prod)', () => {
    expect(
      resolveAppRoot({
        appRootUrl: LOCAL_URL,
        webappRootUrl: DEV_WEBAPP_URL,
        isProdDeploy: false,
      }),
    ).toBe(LOCAL_URL)
  })

  it('uses APP_ROOT_URL when set (explicit override wins on prod too)', () => {
    expect(
      resolveAppRoot({
        appRootUrl: 'https://custom.goodparty.org',
        webappRootUrl: PROD_MARKETING_URL,
        isProdDeploy: true,
      }),
    ).toBe('https://custom.goodparty.org')
  })

  it('falls back to WEBAPP_ROOT_URL on non-prod deploys when APP_ROOT_URL is unset', () => {
    expect(
      resolveAppRoot({
        appRootUrl: undefined,
        webappRootUrl: DEV_WEBAPP_URL,
        isProdDeploy: false,
      }),
    ).toBe(DEV_WEBAPP_URL)
  })

  it('keeps the prod app origin on prod deploys, NOT WEBAPP_ROOT_URL (the marketing origin)', () => {
    // Prod-safety guard: prod WEBAPP_ROOT_URL is the marketing site (where app
    // routes 404); APP_ROOT must stay app.goodparty.org.
    expect(
      resolveAppRoot({
        appRootUrl: undefined,
        webappRootUrl: PROD_MARKETING_URL,
        isProdDeploy: true,
      }),
    ).toBe(PROD_APP_URL)
  })

  it('falls back to the hardcoded prod default when nothing is set', () => {
    expect(
      resolveAppRoot({
        appRootUrl: undefined,
        webappRootUrl: undefined,
        isProdDeploy: false,
      }),
    ).toBe(PROD_APP_URL)
  })
})

describe('APP_ROOT (wired from env)', () => {
  // In the test env (.env.test) APP_ROOT_URL is unset, OTEL_SERVICE_ENVIRONMENT
  // is unset (non-prod), and WEBAPP_ROOT_URL=http://localhost:4000 — so the
  // module-level APP_ROOT must derive from WEBAPP_ROOT_URL, proving the non-prod
  // wiring that was previously broken (it used to hardcode app.goodparty.org).
  it('derives from WEBAPP_ROOT_URL on a non-prod (test) env', () => {
    expect(APP_ROOT).toBe(LOCAL_URL)
  })
})
