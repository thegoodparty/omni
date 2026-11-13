'use client'
import {
  getWebInstrumentations,
  initializeFaro,
  TransportItemType,
} from '@grafana/faro-web-sdk'
import { TracingInstrumentation } from '@grafana/faro-web-tracing'
import { isProductRoute } from 'app/shared/utils/isProductRoute'
import { deploymentEnvironment } from 'app/shared/observability/deploymentEnvironment'

// Every automated browser would start its own billed Faro session, and the
// test-user pause in app/shared/observability/ObservabilityIdentifier.tsx only
// begins after sign-in. The E2E config hides navigator.webdriver on purpose
// (bot checks), so it appends `gp-e2e` to its user agent instead.
const isAutomatedBrowser =
  navigator.webdriver || navigator.userAgent.includes('gp-e2e')

// Unset locally and wherever the Grafana Frontend Observability app has not
// been created yet, and then Faro stays off entirely.
if (process.env.NEXT_PUBLIC_FARO_COLLECTOR_URL && !isAutomatedBrowser) {
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
      // and the error alerts would page on those.
      ...getWebInstrumentations({ captureConsole: false }),
      new TracingInstrumentation(),
    ],
    beforeSend: (item) => {
      const pathname = window.location.pathname
      if (isProductRoute(pathname)) return item
      // A replay is one DOM snapshot plus the changes after it, so dropping
      // the part recorded on a non-product page (the sign-in page a recording
      // usually starts on) breaks the rest of it. /email/* URLs carry a
      // credential and stay out (docs/adr/2026-10-29-email-public-pages-render-without-trackers.md).
      const isReplayEvent =
        item.type === TransportItemType.EVENT &&
        'name' in item.payload &&
        item.payload.name.startsWith('faro.session_recording')
      return isReplayEvent && !pathname.startsWith('/email/') ? item : null
    },
  })
}
