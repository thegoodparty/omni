import { describe, expect, it } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import DraftReadyWidget from './DraftReadyWidget'
import type { OrdinancePresentDraft } from '@goodparty_org/contracts'

const draft: OrdinancePresentDraft = {
  title: 'Draft amendment to Chapter 12, Public Safety Surveillance',
  description:
    'Adds a 30-day retention limit, a siting standard, and an annual audit to the existing camera authority.',
  body: 'Section 12.20  Retention.\n\n(a) Recordings shall be deleted after thirty (30) days unless flagged for an active investigation.',
}

describe('DraftReadyWidget', () => {
  it('shows the draft title and one-line description', () => {
    render(<DraftReadyWidget draft={draft} slug="public-safety-cameras" />)
    expect(
      screen.getByText(
        'Draft amendment to Chapter 12, Public Safety Surveillance',
      ),
    ).toBeVisible()
    expect(
      screen.getByText(/Adds a 30-day retention limit, a siting standard/),
    ).toBeVisible()
  })

  it('is a link that opens the draft document for this ordinance', () => {
    render(<DraftReadyWidget draft={draft} slug="public-safety-cameras" />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute(
      'href',
      '/dashboard/ordinances/draft/public-safety-cameras',
    )
    expect(link).toHaveTextContent('Open draft')
  })

  it('does not render the full ordinance body inline (that lives on the document page)', () => {
    render(<DraftReadyWidget draft={draft} slug="public-safety-cameras" />)
    expect(
      screen.queryByText(/Recordings shall be deleted after thirty/),
    ).not.toBeInTheDocument()
  })

  it('flags the draft as one for the attorney to review', () => {
    render(<DraftReadyWidget draft={draft} slug="public-safety-cameras" />)
    expect(screen.getByText(/Draft for attorney/i)).toBeVisible()
  })

  it('renders without a description', () => {
    render(
      <DraftReadyWidget
        draft={{
          title: 'Draft resolution on Elm and 6th stormwater remediation',
          body: 'Resolution No. [____]',
        }}
        slug="stormwater-elm-6th"
      />,
    )
    expect(
      screen.getByText(
        'Draft resolution on Elm and 6th stormwater remediation',
      ),
    ).toBeVisible()
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/dashboard/ordinances/draft/stormwater-elm-6th',
    )
  })
})
