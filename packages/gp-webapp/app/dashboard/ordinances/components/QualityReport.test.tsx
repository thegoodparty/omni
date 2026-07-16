import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, fireEvent } from '@testing-library/react'
import type {
  Ordinance,
  OrdinanceQualityReport,
} from '@goodparty_org/contracts'
import QualityReport from './QualityReport'

const mocks = vi.hoisted(() => ({ generateQualityReport: vi.fn() }))

vi.mock('../data/ordinances-api', () => ({
  generateQualityReport: mocks.generateQualityReport,
}))

const report = (
  overrides: Partial<OrdinanceQualityReport> = {},
): OrdinanceQualityReport => ({
  checks: [
    {
      id: 'authority',
      label: 'Authority',
      status: 'pass',
      note: 'Solid.',
      source: { id: 's-auth', title: 'Or. Rev. Stat. § 227.215' },
    },
    {
      id: 'legal_conflict',
      label: 'Legal conflict',
      status: 'flag',
      note: 'Conflicts with Chapter 12.',
    },
    {
      id: 'precedent_grounding',
      label: 'Precedent grounding',
      status: 'pass',
      note: 'Grounded.',
    },
    {
      id: 'completeness',
      label: 'Completeness',
      status: 'attention',
      note: 'Add an effective date.',
    },
    { id: 'clarity', label: 'Clarity', status: 'pass', note: 'Clear.' },
    { id: 'voice', label: 'Voice', status: 'pass', note: 'Good.' },
  ],
  tally: { pass: 4, flag: 1, attention: 1 },
  stale: false,
  ranAgainstBodyHash: 'hash-1',
  ...overrides,
})

const props = (over: Partial<Parameters<typeof QualityReport>[0]> = {}) => ({
  slug: 'tree-canopy',
  initialReport: report(),
  draftDirty: false,
  onReran: vi.fn(),
  onDiscussFinding: vi.fn(),
  ...over,
})

describe('QualityReport', () => {
  beforeEach(() => {
    mocks.generateQualityReport.mockReset()
  })

  it('renders the six checks and tally from the report', () => {
    render(<QualityReport {...props()} />)

    expect(screen.getByText(/reviewed by 6 checks/i)).toBeVisible()
    expect(screen.getByText('Authority')).toBeVisible()
    expect(screen.getByText('Conflicts with Chapter 12.')).toBeVisible()
    expect(screen.getByText('4 pass')).toBeVisible()
  })

  it('shows a check source on the collapsed row', () => {
    render(<QualityReport {...props()} />)

    // The source chip is visible without expanding the check.
    expect(screen.getByText('Or. Rev. Stat. § 227.215')).toBeVisible()
  })

  it('generates a report when none exists yet', async () => {
    const onReran = vi.fn()
    mocks.generateQualityReport.mockResolvedValue({
      qualityReport: report(),
    } as unknown as Ordinance)

    render(<QualityReport {...props({ initialReport: null, onReran })} />)

    fireEvent.click(screen.getByRole('button', { name: /run quality checks/i }))

    expect(await screen.findByText(/reviewed by 6 checks/i)).toBeVisible()
    expect(mocks.generateQualityReport).toHaveBeenCalledWith('tree-canopy')
    expect(onReran).toHaveBeenCalled()
  })

  it('disables the run button and shows a reviewing state while running', async () => {
    let resolveRun: ((value: unknown) => void) | undefined
    mocks.generateQualityReport.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRun = resolve
        }),
    )

    render(<QualityReport {...props({ initialReport: null })} />)
    fireEvent.click(screen.getByRole('button', { name: /run quality checks/i }))

    const button = await screen.findByRole('button', { name: /reviewing/i })
    expect(button).toBeDisabled()

    // Settle the run so the test doesn't leak a pending state update.
    resolveRun?.({ qualityReport: report() })
    await screen.findByText(/reviewed by 6 checks/i)
  })

  it('surfaces an error when the run fails', async () => {
    mocks.generateQualityReport.mockRejectedValue(new Error('nope'))

    render(<QualityReport {...props({ initialReport: null })} />)

    fireEvent.click(screen.getByRole('button', { name: /run quality checks/i }))

    expect(
      await screen.findByText(/could not run the quality checks/i),
    ).toBeVisible()
  })

  it('surfaces the API error message when the run is rejected with one', async () => {
    mocks.generateQualityReport.mockRejectedValue({
      data: { message: 'Cannot run quality checks on an empty draft' },
    })

    render(<QualityReport {...props({ initialReport: null })} />)

    fireEvent.click(screen.getByRole('button', { name: /run quality checks/i }))

    expect(
      await screen.findByText(/cannot run quality checks on an empty draft/i),
    ).toBeVisible()
  })

  it('surfaces an error when the run returns no report', async () => {
    const onReran = vi.fn()
    mocks.generateQualityReport.mockResolvedValue({
      qualityReport: null,
    } as unknown as Ordinance)

    render(<QualityReport {...props({ initialReport: null, onReran })} />)

    fireEvent.click(screen.getByRole('button', { name: /run quality checks/i }))

    expect(
      await screen.findByText(/quality report was not returned/i),
    ).toBeVisible()
    expect(onReran).not.toHaveBeenCalled()
  })

  it('keeps the existing report visible when a re-run returns no report', async () => {
    const onReran = vi.fn()
    mocks.generateQualityReport.mockResolvedValue({
      qualityReport: null,
    } as unknown as Ordinance)

    render(<QualityReport {...props({ onReran })} />)

    fireEvent.click(screen.getByRole('button', { name: /re-run/i }))

    expect(
      await screen.findByText(/did not return an updated report/i),
    ).toBeVisible()
    // The previously displayed report is not wiped by the failed re-run.
    expect(screen.getByText(/reviewed by 6 checks/i)).toBeVisible()
    expect(onReran).not.toHaveBeenCalled()
  })

  it('flushes pending edits before generating on re-run', async () => {
    const calls: string[] = []
    const onBeforeRun = vi.fn(async () => {
      calls.push('flush')
    })
    mocks.generateQualityReport.mockImplementation(async () => {
      calls.push('generate')
      return { qualityReport: report() } as unknown as Ordinance
    })

    render(<QualityReport {...props({ onBeforeRun })} />)

    fireEvent.click(screen.getByRole('button', { name: /re-run/i }))

    await screen.findByText(/reviewed by 6 checks/i)
    expect(onBeforeRun).toHaveBeenCalledTimes(1)
    // The flush is awaited before the report is generated.
    expect(calls).toEqual(['flush', 'generate'])
  })

  it('shows a stale banner from the server report', () => {
    render(
      <QualityReport {...props({ initialReport: report({ stale: true }) })} />,
    )

    expect(screen.getByText(/the draft changed/i)).toBeVisible()
  })

  it('shows a stale banner when the draft was edited this session', () => {
    render(<QualityReport {...props({ draftDirty: true })} />)

    expect(screen.getByText(/the draft changed/i)).toBeVisible()
  })

  it('expands a check to reveal its Discuss action and calls onDiscussFinding', () => {
    const onDiscussFinding = vi.fn()
    render(<QualityReport {...props({ onDiscussFinding })} />)

    // Checks start collapsed, so no Discuss action is shown yet.
    expect(screen.queryByRole('button', { name: /discuss/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /authority/i }))

    const discuss = screen.getByRole('button', { name: /discuss/i })
    fireEvent.click(discuss)

    expect(onDiscussFinding).toHaveBeenCalledTimes(1)
    expect(onDiscussFinding.mock.calls[0]?.[0]?.id).toBe('authority')
  })
})
