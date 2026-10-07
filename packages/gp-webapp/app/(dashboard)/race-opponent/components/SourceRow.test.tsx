import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import type { SummarySource } from '@goodparty_org/contracts'
import SourceRow from './SourceRow'

const source: SummarySource = {
  url: 'https://ballotpedia.org/Jane_Rival',
  title: 'Jane Rival candidate profile',
  publisher: 'Ballotpedia',
}

describe('SourceRow', () => {
  it('renders the italic "source:" label alongside the chip', () => {
    render(<SourceRow sources={[source]} />)
    expect(screen.getByText('source:')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /1 source: ballotpedia\.org/i }),
    ).toBeInTheDocument()
  })

  it('renders nothing when there is no source and no internal entry', () => {
    const { container } = render(<SourceRow sources={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the row for a non-linked entry alone', () => {
    render(
      <SourceRow
        sources={[]}
        nonLinkedSource={{ publisher: 'Good Party internal data' }}
      />,
    )
    expect(
      screen.getByRole('button', {
        name: /1 source: Good Party internal data/i,
      }),
    ).toBeInTheDocument()
  })
})
