import * as Sentry from '@sentry/nextjs'
import type { Instrumentation } from 'next'
import { reportServerErrorToGrafana } from 'app/shared/observability/reportServerErrorToGrafana'

export const register = async () => {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
}

export const onRequestError: Instrumentation.onRequestError = async (
  ...args
) => {
  Sentry.captureRequestError(...args)
  await reportServerErrorToGrafana(...args)
}
