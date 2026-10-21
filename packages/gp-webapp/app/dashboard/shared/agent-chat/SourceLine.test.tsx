import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import SourceLine from './SourceLine'

describe('SourceLine', () => {
  it('shows when the source was published beside its chip', () => {
    render(
      <SourceLine
        source={{
          id: 's1',
          title: 'Bear Protection Ordinance',
          url: 'https://bouldercolorado.gov/bears',
          publisher: 'City of Boulder',
          date: 'March 2026',
        }}
      />,
    )
    expect(screen.getByText('Bear Protection Ordinance')).toBeInTheDocument()
    expect(screen.getByText('March 2026')).toBeInTheDocument()
  })

  it('shows no date when the source has none', () => {
    render(<SourceLine source={{ id: 's1', title: 'A report' }} />)
    expect(screen.queryByText('March 2026')).not.toBeInTheDocument()
  })
})
