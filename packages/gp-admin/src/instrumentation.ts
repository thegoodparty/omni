import * as Sentry from '@sentry/nextjs'

export const register = async () => {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
}

// Captures every server-side request error — including server-action throws,
// whose messages Next redacts before they reach the browser — with the real
// message and stack.
export const onRequestError = Sentry.captureRequestError
