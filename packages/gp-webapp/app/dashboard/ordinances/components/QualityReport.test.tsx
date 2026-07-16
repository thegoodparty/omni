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
    { id: 'authority', label: 'Authority', status: 'pass', note: 'Solid.' },
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

  it('generates a report when none exists yet', async () => {
    const onReran = vi.fn()
    mocks.generateQualityReport.mockResolvedValue({
      qualityReport: report(),
    } as unknown as Ordinance)

    render(<QualityReport {...props({ initialReport: null, onReran })} />)

    fireEvent.click(screen.getByRole('button', { name: /run quality checks/i }))

    expect(mocks.generateQualityReport).toHaveBeenCalledWith('tree-canopy')
    expect(await screen.findByText(/reviewed by 6 checks/i)).toBeVisible()
    expect(onReran).toHaveBeenCalled()
  })

  it('surfaces an error when the run fails', async () => {
    mocks.generateQualityReport.mockRejectedValue(new Error('nope'))

    render(<QualityReport {...props({ initialReport: null })} />)

    fireEvent.click(screen.getByRole('button', { name: /run quality checks/i }))

    expect(
      await screen.findByText(/could not run the quality checks/i),
    ).toBeVisible()
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

  it('calls onDiscussFinding for a check', () => {
    const onDiscussFinding = vi.fn()
    render(<QualityReport {...props({ onDiscussFinding })} />)

    const [firstDiscuss] = screen.getAllByRole('button', { name: /discuss/i })
    if (!firstDiscuss) throw new Error('no discuss button')
    fireEvent.click(firstDiscuss)

    expect(onDiscussFinding).toHaveBeenCalledTimes(1)
    expect(onDiscussFinding.mock.calls[0]?.[0]?.id).toBe('authority')
  })
})
