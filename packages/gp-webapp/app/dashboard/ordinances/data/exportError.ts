import type { OrdinanceExportFormat } from '@goodparty_org/contracts'

export type OrdinanceExportErrorKind =
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'server'
  | 'http'
  | 'empty'
  | 'wrong-type'
  | 'save'

// A failed draft export, carrying a message safe to show the user plus the
// details we report to Sentry.
export class OrdinanceExportError extends Error {
  constructor(
    message: string,
    readonly kind: OrdinanceExportErrorKind,
    readonly details: {
      slug: string
      format: OrdinanceExportFormat
      status?: number
      serverMessage?: string
      contentType?: string | null
      cause?: unknown
    },
  ) {
    super(message)
    this.name = 'OrdinanceExportError'
  }
}
