import { describe, expect, it } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import LegislativeHistoryWidget from './LegislativeHistoryWidget'
import type {
  OrdinanceHistoryEntry,
  OrdinanceLegislativeHistory,
} from '@goodparty_org/contracts'

const creationEntry: OrdinanceHistoryEntry = {
  year: 1998,
  label: 'Chapter 12 created',
  summary:
    'Council authorizes the first downtown camera pilot after a string of car break-ins.',
  minutesExcerpt:
    'We want this to be a tool the department uses with restraint, not a blank check for surveillance.',
  speaker: 'Councilor Alvarez',
  source: {
    id: 'min-1998-cam',
    title: 'Maplewood Council minutes, 14 Apr 1998',
    publisher: 'City of Maplewood',
    excerpt: 'Adoption debate, Chapter 12.',
  },
}

const history: OrdinanceLegislativeHistory = {
  chapterLabel: 'Chapter 12, Public Safety Surveillance',
  entries: [
    creationEntry,
    {
      year: 2009,
      label: 'Expanded to transit hubs',
      summary:
        'Camera program extended to the bus depot and two park-and-ride lots.',
      minutesExcerpt:
        'Riders are asking for this. We are not adopting facial recognition, and I want that on the record.',
      speaker: 'Councilor Kim',
      source: {
        id: 'min-2009-cam',
        title: 'Maplewood Council minutes, 22 Jun 2009',
        publisher: 'City of Maplewood',
        excerpt: 'Transit-hub expansion debate.',
      },
    },
    {
      year: 2017,
      label: 'Last amended',
      summary:
        'Budget line item formalized, but no retention rule or siting standard adopted.',
    },
  ],
}

describe('LegislativeHistoryWidget', () => {
  it('renders the heading, chapter sub-line, and every timeline entry', () => {
    render(<LegislativeHistoryWidget history={history} />)
    expect(screen.getByText('Intent and history')).toBeVisible()
    expect(
      screen.getByText(
        'Chapter 12, Public Safety Surveillance. The reasoning behind the law, not just the text.',
      ),
    ).toBeVisible()

    expect(screen.getByText('1998')).toBeVisible()
    expect(screen.getByText('Chapter 12 created')).toBeVisible()
    expect(
      screen.getByText(
        'Council authorizes the first downtown camera pilot after a string of car break-ins.',
      ),
    ).toBeVisible()
    expect(
      screen.getByText(
        /We want this to be a tool the department uses with restraint, not a blank check for surveillance\./,
      ),
    ).toBeVisible()
    expect(screen.getByText('Councilor Alvarez')).toBeVisible()

    expect(screen.getByText('2009')).toBeVisible()
    expect(screen.getByText('Expanded to transit hubs')).toBeVisible()
    expect(
      screen.getByText(
        'Camera program extended to the bus depot and two park-and-ride lots.',
      ),
    ).toBeVisible()
    expect(
      screen.getByText(
        /Riders are asking for this\. We are not adopting facial recognition, and I want that on the record\./,
      ),
    ).toBeVisible()
    expect(screen.getByText('Councilor Kim')).toBeVisible()

    expect(screen.getAllByText('source:')).toHaveLength(2)
    expect(
      screen.getByText('Maplewood Council minutes, 14 Apr 1998'),
    ).toBeVisible()
    expect(
      screen.getByText('Maplewood Council minutes, 22 Jun 2009'),
    ).toBeVisible()
  })

  it('renders an entry without excerpt, speaker, or source as plain year, label, and summary', () => {
    render(<LegislativeHistoryWidget history={history} />)
    expect(screen.getByText('2017')).toBeVisible()
    expect(screen.getByText('Last amended')).toBeVisible()
    expect(
      screen.getByText(
        'Budget line item formalized, but no retention rule or siting standard adopted.',
      ),
    ).toBeVisible()
    expect(screen.getAllByRole('blockquote')).toHaveLength(2)
  })

  it('renders nothing when there are no entries', () => {
    render(<LegislativeHistoryWidget history={{ entries: [] }} />)
    expect(screen.queryByText('Intent and history')).not.toBeInTheDocument()
  })

  it('shows the plain sub-line when chapterLabel is absent', () => {
    render(<LegislativeHistoryWidget history={{ entries: [creationEntry] }} />)
    expect(
      screen.getByText('The reasoning behind the law, not just the text.'),
    ).toBeVisible()
    expect(
      screen.queryByText(/Chapter 12, Public Safety/),
    ).not.toBeInTheDocument()
  })
})
