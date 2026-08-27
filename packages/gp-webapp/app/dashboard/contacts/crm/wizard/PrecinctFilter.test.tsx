import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import type { PrecinctOption } from '@goodparty_org/contracts'
import PrecinctFilter from './PrecinctFilter'

const option = (
  county: string,
  precinct: string,
  voters = 100,
): PrecinctOption => ({ county, precinct, voters })

const renderFilter = (
  options: PrecinctOption[],
  overrides: Partial<Parameters<typeof PrecinctFilter>[0]> = {},
) => {
  const onChange = vi.fn()
  render(
    <PrecinctFilter
      options={options}
      selected={[]}
      onChange={onChange}
      isLoading={false}
      isError={false}
      onRetry={vi.fn()}
      {...overrides}
    />,
  )
  return { onChange }
}

const manyOptions = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    option('ORANGE', String(index + 1).padStart(3, '0')),
  )

describe('PrecinctFilter', () => {
  it('labels a pill with its county so a repeated precinct name is distinguishable', () => {
    renderFilter([
      option('GLOUCESTER', 'MONROE TWP 1-07'),
      option('MIDDLESEX', 'MONROE TWP 1-07'),
    ])

    expect(screen.getByText('Gloucester — MONROE TWP 1-07')).toBeInTheDocument()
    expect(screen.getByText('Middlesex — MONROE TWP 1-07')).toBeInTheDocument()
  })

  it('reports the encoded county|precinct pair when a pill is selected', async () => {
    const { onChange } = renderFilter([option('ORANGE', '711')])

    await userEvent.click(screen.getByText('Orange — 711'))

    expect(onChange).toHaveBeenCalledWith(['ORANGE|711'])
  })

  it('shows at most eight pills, then a View all', () => {
    renderFilter(manyOptions(20))

    expect(screen.getByText('View all 20')).toBeInTheDocument()
    expect(screen.getByText('Orange — 008')).toBeInTheDocument()
    expect(screen.queryByText('Orange — 009')).not.toBeInTheDocument()
  })

  it('renders no View all when everything fits inline', () => {
    renderFilter(manyOptions(8))

    expect(screen.queryByText(/View all/)).not.toBeInTheDocument()
    expect(screen.getByText('Orange — 008')).toBeInTheDocument()
  })

  // A selection made in the sheet must stay visible on the step after it
  // closes, otherwise the user cannot see or clear what they picked.
  it('promotes a hidden selection into the inline row', () => {
    renderFilter(manyOptions(20), { selected: ['ORANGE|015'] })

    expect(screen.getByText('Orange — 015')).toBeInTheDocument()
  })

  // Clicking an inline pill must not reorder the row under the cursor.
  it('keeps inline pills in place when one of them is selected', () => {
    renderFilter(manyOptions(20), { selected: ['ORANGE|003'] })

    const labels = screen
      .getAllByText(/^Orange — \d{3}$/)
      .map((node) => node.textContent)
    expect(labels[0]).toBe('Orange — 001')
  })

  describe('the Unknown bucket', () => {
    it('is absent when every voter has a precinct', () => {
      renderFilter([option('ORANGE', '711')])

      expect(screen.queryByText('Unknown')).not.toBeInTheDocument()
    })

    it('renders as a plain Unknown pill, not a county-prefixed one', () => {
      renderFilter([option('ORANGE', '711'), option('ORANGE', '', 37)])

      expect(screen.getByText('Unknown')).toBeInTheDocument()
      expect(screen.queryByText('Orange — ')).not.toBeInTheDocument()
    })

    // It is a small edge bucket, so it must never take one of the eight slots
    // away by sorting early — but it must always be reachable without the
    // sheet, so it is pinned rather than dropped.
    it('stays inline even when the named precincts overflow', () => {
      renderFilter([...manyOptions(50), option('ORANGE', '', 37)])

      expect(screen.getByText('Unknown')).toBeInTheDocument()
      expect(screen.getByText('View all 50')).toBeInTheDocument()
      expect(screen.getByText('Orange — 007')).toBeInTheDocument()
      expect(screen.queryByText('Orange — 008')).not.toBeInTheDocument()
    })

    it('selects every county’s unassigned bucket from the one pill', async () => {
      const { onChange } = renderFilter([
        option('GLOUCESTER', '', 12),
        option('MIDDLESEX', '', 30),
      ])

      await userEvent.click(screen.getByText('Unknown'))

      expect(onChange).toHaveBeenCalledWith(['GLOUCESTER|', 'MIDDLESEX|'])
    })
  })

  // 19 counties nationwide start with "MC" (McHenry and McLean IL, McPherson
  // KS among them). Plain title-casing renders them "Mchenry".
  it('capitalises a Mc- county correctly', () => {
    renderFilter([option('MCHENRY', '0042')])

    expect(screen.getByText('McHenry — 0042')).toBeInTheDocument()
  })

  // The Unknown pill is a raw button, not a ToggleGroupItem, so Radix sets no
  // pressed state for it — it has to be declared, or the control reads as
  // inert to assistive tech and to any aria-driven assertion.
  it('exposes the Unknown pill’s pressed state via aria-pressed', async () => {
    const { onChange } = renderFilter([
      option('ORANGE', '711'),
      option('ORANGE', '', 37),
    ])

    const unknown = screen.getByRole('button', { name: 'Unknown' })
    expect(unknown).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(unknown)
    expect(onChange).toHaveBeenCalledWith(['ORANGE|'])
  })

  it('reflects a selected Unknown as pressed', () => {
    renderFilter([option('ORANGE', '711'), option('ORANGE', '', 37)], {
      selected: ['ORANGE|'],
    })

    expect(screen.getByRole('button', { name: 'Unknown' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('explains an empty result instead of rendering an empty control', () => {
    renderFilter([])

    expect(screen.getByText('No precinct data found.')).toBeInTheDocument()
  })

  it('offers a retry without blocking the rest of the step', () => {
    renderFilter([], { isError: true })

    expect(screen.getByText(/couldn’t load precincts/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument()
  })
})
