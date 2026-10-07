import { describe, expect, it } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import CurrentLawSummaryWidget from './CurrentLawSummaryWidget'
import type { OrdinanceCurrentLawSummary } from '@goodparty_org/contracts'

const summary: OrdinanceCurrentLawSummary = {
  chapterLabel: 'Chapter 12, Public Safety Surveillance',
  source: {
    id: 'ch-12-cameras',
    title: 'Maplewood City Code, Ch. 12.40',
    publisher: 'City of Maplewood',
    excerpt:
      'Authorizes police-operated cameras in public spaces. Last amended 2017.',
  },
  does: [
    {
      title: 'Police may install cameras in public rights-of-way',
      subtitle:
        'Cameras on poles, intersections, and city-owned facilities are explicitly allowed.',
    },
    {
      title: 'Footage is held by the police department',
      subtitle: 'Access is limited to sworn officers and authorized requests.',
    },
    {
      title: 'Annual budget line item for camera operations',
      subtitle:
        '$140K this year covers maintenance and storage of 22 existing cameras.',
    },
  ],
  gaps: [
    {
      title: 'No published siting criteria',
      subtitle:
        'Residents cannot see why a camera is going on their block before it goes up.',
    },
    {
      title: 'No retention limit on footage',
      subtitle:
        'Recordings are kept indefinitely. No deletion schedule in code.',
    },
    {
      title: 'No annual public report',
      subtitle:
        'Nothing tells the council whether the cameras are actually solving cases.',
    },
  ],
}

describe('CurrentLawSummaryWidget', () => {
  it('renders the chapter, both cards, every row, and the source chip', () => {
    render(<CurrentLawSummaryWidget summary={summary} />)
    expect(
      screen.getByText('Chapter 12, Public Safety Surveillance'),
    ).toBeVisible()
    expect(screen.getByText('What it does today')).toBeVisible()
    expect(screen.getByText('Where there are gaps')).toBeVisible()
    for (const point of [...summary.does, ...summary.gaps]) {
      expect(screen.getByText(point.title)).toBeVisible()
      if (point.subtitle) {
        expect(screen.getByText(point.subtitle)).toBeVisible()
      }
    }
    expect(screen.getByText('source:')).toBeVisible()
    expect(screen.getByText('Maplewood City Code, Ch. 12.40')).toBeVisible()
  })

  it('renders no gaps card when gaps is empty', () => {
    render(<CurrentLawSummaryWidget summary={{ ...summary, gaps: [] }} />)
    expect(screen.getByText('What it does today')).toBeVisible()
    expect(screen.queryByText('Where there are gaps')).not.toBeInTheDocument()
  })

  it('renders only the header block when both lists are empty', () => {
    render(
      <CurrentLawSummaryWidget summary={{ ...summary, does: [], gaps: [] }} />,
    )
    expect(
      screen.getByText('Chapter 12, Public Safety Surveillance'),
    ).toBeVisible()
    expect(screen.queryByText('What it does today')).not.toBeInTheDocument()
    expect(screen.queryByText('Where there are gaps')).not.toBeInTheDocument()
  })

  it('renders a subtitle-less row as its title alone', () => {
    render(
      <CurrentLawSummaryWidget
        summary={{
          ...summary,
          does: [
            { title: 'Police may install cameras in public rights-of-way' },
          ],
          gaps: [],
        }}
      />,
    )
    const row = screen.getByRole('listitem')
    expect(row.textContent).toBe(
      'Police may install cameras in public rights-of-way',
    )
  })

  it('omits the source line when the payload has none', () => {
    const { source: _dropped, ...withoutSource } = summary
    render(<CurrentLawSummaryWidget summary={withoutSource} />)
    expect(
      screen.getByText('Chapter 12, Public Safety Surveillance'),
    ).toBeVisible()
    expect(screen.queryByText('source:')).not.toBeInTheDocument()
  })
})
