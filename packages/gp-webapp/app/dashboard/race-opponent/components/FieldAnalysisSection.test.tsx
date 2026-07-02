import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import type { RaceOpponentFieldAnalysis } from 'gpApi/api-endpoints'
import FieldAnalysisSection from './FieldAnalysisSection'

const fullFieldAnalysis: RaceOpponentFieldAnalysis = {
  strengths: ['Strong grassroots fundraising base'],
  weaknesses: ['Low name recognition outside the district core'],
  opportunities: ['Opponent has no ground game in the suburbs'],
  threats: ['Incumbent holds a 2-1 fundraising lead'],
  sources: [
    {
      url: 'https://opponent.example.com/platform',
      title: 'Campaign platform',
      publisher: 'Opponent for Congress',
    },
  ],
  generatedAt: '2026-06-30T12:00:00.000Z',
}

describe('FieldAnalysisSection', () => {
  it('renders all four quadrants with their items, icons, and labels', () => {
    render(<FieldAnalysisSection fieldAnalysis={fullFieldAnalysis} />)

    expect(
      screen.getByRole('heading', {
        name: 'How your campaign stacks up against the field',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Use this analysis to help decide where to lean in and where to shore up.',
      ),
    ).toBeInTheDocument()

    expect(screen.getByText('Strengths')).toBeInTheDocument()
    expect(
      screen.getByText('Strong grassroots fundraising base'),
    ).toBeInTheDocument()
    expect(screen.getByText('Weaknesses')).toBeInTheDocument()
    expect(
      screen.getByText('Low name recognition outside the district core'),
    ).toBeInTheDocument()
    expect(screen.getByText('Opportunities')).toBeInTheDocument()
    expect(
      screen.getByText('Opponent has no ground game in the suburbs'),
    ).toBeInTheDocument()
    expect(screen.getByText('Threats')).toBeInTheDocument()
    expect(
      screen.getByText('Incumbent holds a 2-1 fundraising lead'),
    ).toBeInTheDocument()
  })

  it('renders nothing for a null fieldAnalysis', () => {
    const { container } = render(<FieldAnalysisSection fieldAnalysis={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for an undefined fieldAnalysis', () => {
    const { container } = render(
      <FieldAnalysisSection fieldAnalysis={undefined} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('omits an empty quadrant but keeps the section when 2+ quadrants have content', () => {
    const analysis: RaceOpponentFieldAnalysis = {
      ...fullFieldAnalysis,
      weaknesses: [],
    }
    render(<FieldAnalysisSection fieldAnalysis={analysis} />)

    expect(screen.getByText('Strengths')).toBeInTheDocument()
    expect(screen.getByText('Opportunities')).toBeInTheDocument()
    expect(screen.getByText('Threats')).toBeInTheDocument()
    expect(screen.queryByText('Weaknesses')).not.toBeInTheDocument()
  })

  it('renders the section when exactly 2 quadrants have content', () => {
    const analysis: RaceOpponentFieldAnalysis = {
      ...fullFieldAnalysis,
      weaknesses: [],
      opportunities: [],
    }
    render(<FieldAnalysisSection fieldAnalysis={analysis} />)

    expect(
      screen.getByRole('heading', {
        name: 'How your campaign stacks up against the field',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('Strengths')).toBeInTheDocument()
    expect(screen.getByText('Threats')).toBeInTheDocument()
  })

  it('omits the whole section when fewer than 2 quadrants have content', () => {
    const analysis: RaceOpponentFieldAnalysis = {
      ...fullFieldAnalysis,
      weaknesses: [],
      opportunities: [],
      threats: [],
    }
    const { container } = render(
      <FieldAnalysisSection fieldAnalysis={analysis} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('omits the whole section when every quadrant is empty', () => {
    const analysis: RaceOpponentFieldAnalysis = {
      strengths: [],
      weaknesses: [],
      opportunities: [],
      threats: [],
      sources: [],
      generatedAt: null,
    }
    const { container } = render(
      <FieldAnalysisSection fieldAnalysis={analysis} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the source row with the internal entry first, and not as a link', async () => {
    render(<FieldAnalysisSection fieldAnalysis={fullFieldAnalysis} />)

    const trigger = screen.getByRole('button', {
      name: /2 sources: Good Party internal data/i,
    })
    expect(trigger).toBeInTheDocument()

    trigger.focus()
    await screen.findByText('1/2', {}, { timeout: 2000 })

    // Chip label + open-card body both show it — the card is genuinely open.
    expect(
      screen.getAllByText('Good Party internal data').length,
    ).toBeGreaterThan(1)
    expect(
      screen.queryByRole('link', { name: /Good Party internal data/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Open source in a new tab' }),
    ).not.toBeInTheDocument()
  })

  it('shows only the internal source entry when there are no web sources', () => {
    const analysis: RaceOpponentFieldAnalysis = {
      ...fullFieldAnalysis,
      sources: [],
    }
    render(<FieldAnalysisSection fieldAnalysis={analysis} />)

    expect(
      screen.getByRole('button', {
        name: /1 source: Good Party internal data/i,
      }),
    ).toBeInTheDocument()
  })
})
