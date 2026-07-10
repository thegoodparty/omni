import { describe, expect, it } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import ComparablesWidget from './ComparablesWidget'
import type { OrdinancePresentComparables } from '@goodparty_org/contracts'

const presentation: OrdinancePresentComparables = {
  intro:
    "I pulled the closest comparable camera ordinances from peer cities. Two held up. One got pulled after a civil-liberties lawsuit, and that one's the most instructive.",
  takeaway:
    'The pattern: cities that paired expansion with siting criteria, retention limits, and oversight held up.',
  comparables: [
    {
      city: 'Edgewater',
      state: 'Oregon',
      population: 29000,
      year: 2022,
      headline: 'Adopted siting criteria and a 30-day retention limit',
      quote:
        'New cameras shall be sited based on published crime-density data, with footage retained no longer than thirty days unless tied to an active investigation.',
      outcome:
        'Camera count grew 40% with no successful civil-liberties challenge.',
      status: 'passed',
      source: {
        id: 'edgewater-2022-cam',
        title: 'Ordinance 2022-09, Public Safety Surveillance',
        publisher: 'City of Edgewater',
        url: 'https://edgewatercity.gov/code/12.40',
        excerpt: 'Adopted May 2022. Sets siting criteria and 30-day retention.',
      },
    },
    {
      city: 'Lindel',
      state: 'Oregon',
      population: 31000,
      year: 2020,
      headline: 'Citywide facial-recognition cameras, repealed',
      quote:
        'All new public cameras shall be equipped with facial-recognition matching against a county watchlist.',
      outcome:
        'Repealed in 2022 after an ACLU suit and resident pushback at four packed council meetings.',
      status: 'repealed',
      failureReason:
        'No siting criteria, no retention limit, no opt-out for sensitive locations like clinics or houses of worship.',
      source: {
        id: 'lindel-2020-cam',
        title: 'Ordinance 2020-11 (repealed)',
        publisher: 'City of Lindel',
        url: 'https://lindelcity.gov/ord/2020-11',
        excerpt: 'Adopted Mar 2020, repealed Jul 2022 by Ordinance 2022-19.',
      },
    },
  ],
}

describe('ComparablesWidget', () => {
  it('renders the full payload: intro, cards with every field, takeaway', () => {
    render(<ComparablesWidget presentation={presentation} />)
    expect(
      screen.getByText(
        /I pulled the closest comparable camera ordinances from peer cities/,
      ),
    ).toBeVisible()
    expect(
      screen.getByText(
        /The pattern: cities that paired expansion with siting criteria/,
      ),
    ).toBeVisible()
    expect(screen.getByText('Edgewater, Oregon')).toBeVisible()
    expect(screen.getByText('Lindel, Oregon')).toBeVisible()
    expect(screen.getByText(/pop 29,000/)).toBeVisible()
    expect(screen.getByText(/pop 29,000 · 2022/)).toBeVisible()
    expect(
      screen.getByText('Adopted siting criteria and a 30-day retention limit'),
    ).toBeVisible()
    expect(
      screen.getByText('Citywide facial-recognition cameras, repealed'),
    ).toBeVisible()
    expect(
      screen.getByText(
        /New cameras shall be sited based on published crime-density data/,
      ),
    ).toBeVisible()
    expect(
      screen.getByText(
        /All new public cameras shall be equipped with facial-recognition matching/,
      ),
    ).toBeVisible()
    expect(screen.getAllByText('Outcome.')).toHaveLength(2)
    expect(
      screen.getByText(
        /Camera count grew 40% with no successful civil-liberties challenge/,
      ),
    ).toBeVisible()
    expect(
      screen.getByText(/Repealed in 2022 after an ACLU suit/),
    ).toBeVisible()
    expect(screen.getAllByText('source:')).toHaveLength(2)
    expect(
      screen.getByText('Ordinance 2022-09, Public Safety Surveillance'),
    ).toBeVisible()
    expect(screen.getByText('Ordinance 2020-11 (repealed)')).toBeVisible()
  })

  it('marks the repealed card with the destructive badge and failure reason', () => {
    render(<ComparablesWidget presentation={presentation} />)
    expect(screen.getByText('Repealed')).toBeVisible()
    expect(screen.getByText('Why it failed.')).toBeVisible()
    expect(
      screen.getByText(
        /No siting criteria, no retention limit, no opt-out for sensitive locations/,
      ),
    ).toBeVisible()
  })

  it('shows Passed on the passed card without a failure reason', () => {
    render(<ComparablesWidget presentation={presentation} />)
    expect(screen.getByText('Passed')).toBeVisible()
    expect(screen.getAllByText('Why it failed.')).toHaveLength(1)
  })

  it('renders a minimal unknown-status comparable without pop, year, or outcome', () => {
    render(
      <ComparablesWidget
        presentation={{
          comparables: [
            {
              city: 'Fairview',
              state: 'Ohio',
              quote: 'Cameras may be installed at the discretion of the chief.',
              status: 'unknown',
              source: {
                id: 'fairview-cam',
                title: 'Municipal Code ch. 8',
                publisher: 'City of Fairview',
              },
            },
          ],
        }}
      />,
    )
    expect(screen.getByText('Unknown')).toBeVisible()
    const metaLine = screen.getByText('Fairview, Ohio')
    expect(metaLine).toHaveTextContent(/^Fairview, Ohio$/)
    expect(screen.queryByText(/pop /)).not.toBeInTheDocument()
    expect(
      screen.getByText(
        /Cameras may be installed at the discretion of the chief/,
      ),
    ).toBeVisible()
    expect(screen.queryByText('Outcome.')).not.toBeInTheDocument()
  })

  it('renders nothing when there are no comparables and no prose', () => {
    const { container } = render(
      <ComparablesWidget presentation={{ comparables: [] }} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders intro prose even when comparables are empty', () => {
    render(
      <ComparablesWidget
        presentation={{
          intro:
            "I pulled the closest comparable camera ordinances from peer cities. Two held up. One got pulled after a civil-liberties lawsuit, and that one's the most instructive.",
          comparables: [],
        }}
      />,
    )
    expect(
      screen.getByText(
        /I pulled the closest comparable camera ordinances from peer cities/,
      ),
    ).toBeVisible()
  })
})
