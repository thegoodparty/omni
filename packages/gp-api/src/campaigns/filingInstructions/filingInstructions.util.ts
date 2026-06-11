import { format, isValid, parseISO } from 'date-fns'
import { Campaign } from 'src/generated/prisma'
import type {
  FilingInstructionsContent,
  RaceTargetMetrics,
} from '@goodparty_org/contracts'

// details.filingPeriods* are ISO date strings written by the filing-data
// pipeline, but `details` is a loosely-typed JSON column edited by several
// writers — an unparseable value would throw in `format` and 500 the email
// route, so fall back to the raw string rather than failing the send.
const formatFilingDate = (value: string | null | undefined): string | null => {
  if (!value) return null
  const parsed = parseISO(value)
  return isValid(parsed) ? format(parsed, 'MMMM d, yyyy') : value
}

const formatFilingWindow = (
  start: string | null | undefined,
  end: string | null | undefined,
): string => {
  const formattedStart = formatFilingDate(start)
  const formattedEnd = formatFilingDate(end)
  if (formattedStart && formattedEnd) {
    return `${formattedStart} – ${formattedEnd}`
  }
  return formattedStart ?? formattedEnd ?? 'Not yet available'
}

/**
 * Builds the filing-instructions content for the pre-payment pro-upgrade
 * wizard's filing-instructions screen (shown to candidates before they
 * subscribe): filing window (from `campaign.details`), plus fee / requirements
 * / office contact (from the live race-target metrics). The single source the
 * screen renders and the "email this to me" body composes from, so the two
 * surfaces can't drift.
 */
export const buildFilingInstructionsContent = (
  campaign: Campaign,
  metrics: RaceTargetMetrics | null,
): FilingInstructionsContent => {
  const { filingPeriodsStart, filingPeriodsEnd } = campaign.details ?? {}
  return {
    filingWindow: formatFilingWindow(filingPeriodsStart, filingPeriodsEnd),
    filingFee: metrics?.filingFee ?? null,
    filingRequirementsText: metrics?.filingRequirementsText ?? null,
    filingOfficeAddress: metrics?.filingOfficeAddress ?? null,
    filingPhoneNumber: metrics?.filingPhoneNumber ?? null,
    paperworkInstructions: metrics?.paperworkInstructions ?? null,
  }
}

/**
 * Renders the plain-text "email this to me" body from the shared
 * filing-instructions content. Sections with no data are omitted so the
 * candidate never sees empty labels.
 */
export const renderFilingInstructionsEmail = (
  content: FilingInstructionsContent,
): string => {
  const lines: string[] = [
    'Here are the filing instructions for your campaign.',
    '',
    `Filing window: ${content.filingWindow}`,
  ]

  if (content.filingFee != null) {
    lines.push(`Filing fee: $${content.filingFee}`)
  }
  if (content.filingRequirementsText) {
    lines.push(`Filing requirements: ${content.filingRequirementsText}`)
  }

  const officeLines: string[] = []
  if (content.filingOfficeAddress) {
    officeLines.push(`Address: ${content.filingOfficeAddress}`)
  }
  if (content.filingPhoneNumber) {
    officeLines.push(`Phone: ${content.filingPhoneNumber}`)
  }
  if (content.paperworkInstructions) {
    officeLines.push(`Instructions: ${content.paperworkInstructions}`)
  }
  if (officeLines.length > 0) {
    lines.push('', 'Filing office', ...officeLines)
  }

  return lines.join('\n')
}
