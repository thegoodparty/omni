import { describe, expect, it } from 'vitest'
import { Campaign } from 'src/generated/prisma'
import type {
  FilingInstructionsContent,
  RaceTargetMetrics,
} from '@goodparty_org/contracts'
import {
  buildFilingInstructionsContent,
  renderFilingInstructionsEmail,
} from './filingInstructions.util'

const campaignWith = (details: object): Campaign =>
  ({ details }) as unknown as Campaign

const metricsWith = (
  overrides: Partial<RaceTargetMetrics>,
): RaceTargetMetrics =>
  ({
    filingFee: null,
    filingRequirementsText: null,
    filingOfficeAddress: null,
    filingPhoneNumber: null,
    paperworkInstructions: null,
    ...overrides,
  }) as RaceTargetMetrics

const contentWith = (
  overrides: Partial<FilingInstructionsContent>,
): FilingInstructionsContent => ({
  filingWindow: 'Not yet available',
  filingFee: null,
  filingRequirementsText: null,
  filingOfficeAddress: null,
  filingPhoneNumber: null,
  paperworkInstructions: null,
  ...overrides,
})

describe('buildFilingInstructionsContent', () => {
  it('formats the window and carries the metrics fields through', () => {
    const content = buildFilingInstructionsContent(
      campaignWith({
        filingPeriodsStart: '2026-06-01',
        filingPeriodsEnd: '2026-06-15',
      }),
      metricsWith({
        filingFee: 100,
        filingRequirementsText: 'Filing fee: $100.',
        filingOfficeAddress: '500 Election Way, Sacramento, CA 95814',
        filingPhoneNumber: '(916) 555-0199',
        paperworkInstructions: 'Submit to the city clerk.',
      }),
    )

    expect(content).toEqual({
      filingWindow: 'June 1, 2026 – June 15, 2026',
      filingFee: 100,
      filingRequirementsText: 'Filing fee: $100.',
      filingOfficeAddress: '500 Election Way, Sacramento, CA 95814',
      filingPhoneNumber: '(916) 555-0199',
      paperworkInstructions: 'Submit to the city clerk.',
    })
  })

  it('nulls the metrics fields and shows the window fallback when absent', () => {
    expect(buildFilingInstructionsContent(campaignWith({}), null)).toEqual({
      filingWindow: 'Not yet available',
      filingFee: null,
      filingRequirementsText: null,
      filingOfficeAddress: null,
      filingPhoneNumber: null,
      paperworkInstructions: null,
    })
  })

  it('falls back to the raw value when a filing date is not parseable', () => {
    const content = buildFilingInstructionsContent(
      campaignWith({ filingPeriodsStart: 'rolling', filingPeriodsEnd: null }),
      null,
    )

    expect(content.filingWindow).toBe('rolling')
  })
})

describe('renderFilingInstructionsEmail', () => {
  it('renders window, fee, requirements, and office contact when all present', () => {
    const body = renderFilingInstructionsEmail(
      contentWith({
        filingWindow: 'June 1, 2026 – June 15, 2026',
        filingFee: 100,
        filingRequirementsText: 'Filing fee: $100.',
        filingOfficeAddress: '500 Election Way, Sacramento, CA 95814',
        filingPhoneNumber: '(916) 555-0199',
        paperworkInstructions: 'Submit to the city clerk.',
      }),
    )

    expect(body).toContain('Filing window: June 1, 2026 – June 15, 2026')
    expect(body).toContain('Filing fee: $100')
    expect(body).toContain('Filing requirements: Filing fee: $100.')
    expect(body).toContain('Filing office')
    expect(body).toContain('Address: 500 Election Way, Sacramento, CA 95814')
    expect(body).toContain('Phone: (916) 555-0199')
    expect(body).toContain('Instructions: Submit to the city clerk.')
  })

  it('omits fee, requirements, and the office block when metrics are null', () => {
    const body = renderFilingInstructionsEmail(
      contentWith({ filingWindow: 'June 1, 2026 – June 15, 2026' }),
    )

    expect(body).toContain('Filing window: June 1, 2026 – June 15, 2026')
    expect(body).not.toContain('Filing fee:')
    expect(body).not.toContain('Filing requirements:')
    expect(body).not.toContain('Filing office')
  })

  it('renders a $0 fee (fee present but zero is not "no data")', () => {
    const body = renderFilingInstructionsEmail(contentWith({ filingFee: 0 }))

    expect(body).toContain('Filing fee: $0')
  })

  it('shows "Not yet available" when the filing window is missing', () => {
    const body = renderFilingInstructionsEmail(
      contentWith({ filingWindow: 'Not yet available' }),
    )

    expect(body).toContain('Filing window: Not yet available')
  })
})
