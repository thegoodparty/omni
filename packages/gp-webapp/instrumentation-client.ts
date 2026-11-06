'use client'
import * as Sentry from '@sentry/nextjs'
import { browserProfilingIntegration } from '@sentry/browser'
import { getWebInstrumentations, initializeFaro } from '@grafana/faro-web-sdk'
import { TracingInstrumentation } from '@grafana/faro-web-tracing'
import { isProductRoute } from 'app/shared/utils/isProductRoute'
import { deploymentEnvironment } from 'app/shared/observability/deploymentEnvironment'

Sentry.init({
  dsn: 'https://6a3734c28a66ca850443447cd6d1f691@o4510915540025344.ingest.us.sentry.io/4510915613884416',
  enabled: !process.env.NEXT_PUBLIC_API_BASE?.includes('localhost'),

  tracesSampler: ({ parentSampled }) => {
    if (parentSampled !== undefined) return parentSampled
    if (!isProductRoute(window.location.pathname)) return 0
    return 1.0
  },

  profileSessionSampleRate: 0.1,
  profileLifecycle: 'trace',

  integrations: [
    Sentry.replayIntegration({
      maskAllText: false,
      maskAllInputs: true,
      blockAllMedia: false,
    }),
    browserProfilingIntegration(),
  ],

  // We explicitly enable replays programmatically in the SentryIdentifier component
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  // Don't send events from non-product routes
  beforeSend: (event) => {
    if (!isProductRoute(window.location.pathname)) {
      return null
    }
    return event
  },
  beforeSendTransaction: (event) => {
    if (!isProductRoute(window.location.pathname)) {
      return null
    }
    return event
  },
})

// Unset locally and wherever the Grafana Frontend Observability app has not
// been created yet, and then Faro stays off entirely.
if (process.env.NEXT_PUBLIC_FARO_COLLECTOR_URL) {
  const gitSha = process.env.NEXT_PUBLIC_GIT_SHA
  // Faro reads the bundle id from this global when it initializes, and it is
  // what matches an error to the source maps scripts/upload-faro-sourcemaps.mjs
  // uploaded for this build. Set here rather than with the Faro CLI's
  // inject-bundle-id, which prepends to every built chunk after the source
  // maps were written and so shifts the first line out from under them.
  if (gitSha) {
    Object.assign(globalThis, { '__faroBundleId_gp-webapp': gitSha })
  }

  initializeFaro({
    // Same-origin relay to the collector, see app/fx/route.ts.
    url: `${window.location.origin}/fx`,
    app: {
      name: 'gp-webapp',
      version: gitSha || 'local',
      environment: deploymentEnvironment(),
    },
    instrumentations: [
      // Console capture off: it turns every console.error into an exception,
      // which Sentry never counted and the error alerts would page on.
      ...getWebInstrumentations({ captureConsole: false }),
      new TracingInstrumentation(),
    ],
    beforeSend: (item) =>
      isProductRoute(window.location.pathname) ? item : null,
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
