import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import type {
  Ordinance,
  OrdinanceQualityReport,
} from '@goodparty_org/contracts'
import QualityReport from './QualityReport'

const mocks = vi.hoisted(() => ({
  fetchOrdinanceBySlug: vi.fn(),
  generateQualityReport: vi.fn(),
}))

vi.mock('../data/ordinances-api', () => ({
  fetchOrdinanceBySlug: mocks.fetchOrdinanceBySlug,
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

const ordinance = (qualityReport: OrdinanceQualityReport | null): Ordinance =>
  ({ id: 'ord-1', slug: 'tree-canopy', qualityReport }) as unknown as Ordinance

describe('QualityReport', () => {
  beforeEach(() => {
    mocks.fetchOrdinanceBySlug.mockReset()
    mocks.generateQualityReport.mockReset()
  })

  it('renders the six checks and tally after load', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(ordinance(report()))

    render(<QualityReport slug="tree-canopy" onDiscussFinding={vi.fn()} />)

    expect(await screen.findByText(/reviewed by 6 checks/i)).toBeVisible()
    expect(screen.getByText('Authority')).toBeVisible()
    expect(screen.getByText('Conflicts with Chapter 12.')).toBeVisible()
    expect(screen.getByText('4 pass')).toBeVisible()
  })

  it('generates the report when none exists yet', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(ordinance(null))
    mocks.generateQualityReport.mockResolvedValue(ordinance(report()))

    render(<QualityReport slug="tree-canopy" onDiscussFinding={vi.fn()} />)

    const run = await screen.findByRole('button', {
      name: /run quality checks/i,
    })
    fireEvent.click(run)

    expect(mocks.generateQualityReport).toHaveBeenCalledWith('tree-canopy')
    expect(await screen.findByText(/reviewed by 6 checks/i)).toBeVisible()
  })

  it('shows a stale banner when the draft changed since the report ran', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(
      ordinance(report({ stale: true })),
    )

    render(<QualityReport slug="tree-canopy" onDiscussFinding={vi.fn()} />)

    expect(await screen.findByText(/the draft changed/i)).toBeVisible()
    expect(screen.getByRole('button', { name: /re-run/i })).toBeVisible()
  })

  it('calls onDiscussFinding for a check', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(ordinance(report()))
    const onDiscussFinding = vi.fn()

    render(
      <QualityReport slug="tree-canopy" onDiscussFinding={onDiscussFinding} />,
    )

    await screen.findByText(/reviewed by 6 checks/i)
    fireEvent.click(screen.getAllByRole('button', { name: /discuss/i })[0])

    await waitFor(() => expect(onDiscussFinding).toHaveBeenCalledTimes(1))
    expect(onDiscussFinding.mock.calls[0][0].id).toBe('authority')
  })
})
