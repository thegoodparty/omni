import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import type { SummarySource } from '@goodparty_org/contracts'
import SourceChip from './SourceChip'

const threeSources: SummarySource[] = [
  {
    url: 'https://ballotpedia.org/Jane_Rival',
    title: 'Jane Rival candidate profile',
    publisher: 'Ballotpedia',
    description: 'A nonpartisan encyclopedia of American politics.',
  },
  {
    url: 'https://janerival.example.com/issues',
    title: 'Jane Rival on the issues',
    publisher: 'Jane Rival for Congress',
  },
  {
    url: 'https://localnews.example.com/rival-profile',
    title: 'Meet the challenger',
    publisher: 'Local News',
  },
]

const openChip = async () => {
  const user = userEvent.setup()
  render(<SourceChip sources={threeSources} />)
  const trigger = screen.getByRole('button', {
    name: /3 sources: ballotpedia\.org/i,
  })
  trigger.focus()
  const title = await screen.findByRole(
    'link',
    { name: /Jane Rival candidate profile/i },
    { timeout: 2000 },
  )
  return { user, title }
}

describe('SourceChip', () => {
  it('renders the chip label and +N count for a 3-source array', () => {
    render(<SourceChip sources={threeSources} />)
    expect(
      screen.getByRole('button', { name: /3 sources: ballotpedia\.org/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('ballotpedia.org')).toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('opens the carousel on focus and shows the first source', async () => {
    await openChip()
    expect(screen.getByText('1/3')).toBeInTheDocument()
  })

  it('next/prev change the rendered title and the bounds disable', async () => {
    const { user } = await openChip()

    const prevButton = screen.getByRole('button', { name: 'Previous source' })
    const nextButton = screen.getByRole('button', { name: 'Next source' })
    expect(prevButton).toBeDisabled()
    expect(nextButton).not.toBeDisabled()

    await user.click(nextButton)
    expect(screen.getByText('2/3')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Jane Rival on the issues/i }),
    ).toBeInTheDocument()
    expect(prevButton).not.toBeDisabled()
    expect(nextButton).not.toBeDisabled()

    await user.click(nextButton)
    expect(screen.getByText('3/3')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Meet the challenger/i }),
    ).toBeInTheDocument()
    expect(nextButton).toBeDisabled()

    await user.click(prevButton)
    expect(screen.getByText('2/3')).toBeInTheDocument()
  })

  it('shows no +N for a single source and disables both carousel buttons', async () => {
    render(<SourceChip sources={[threeSources[0]!]} />)
    expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument()

    const trigger = screen.getByRole('button', {
      name: /1 source: ballotpedia\.org/i,
    })
    trigger.focus()
    await screen.findByRole(
      'link',
      { name: /Jane Rival candidate profile/i },
      { timeout: 2000 },
    )

    expect(
      screen.getByRole('button', { name: 'Previous source' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next source' })).toBeDisabled()
  })

  it('renders a leading non-linked entry in the chip and carousel without an anchor', async () => {
    const user = userEvent.setup()
    render(
      <SourceChip
        sources={threeSources}
        nonLinkedSource={{ publisher: 'Good Party internal data' }}
      />,
    )

    const trigger = screen.getByRole('button', {
      name: /4 sources: Good Party internal data/i,
    })
    trigger.focus()
    await screen.findByText('1/4', {}, { timeout: 2000 })

    // The internal entry's publisher name renders in the body but is never a
    // link, since it has no url to open.
    expect(
      screen.queryByRole('link', { name: /Good Party internal data/i }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next source' }))
    expect(screen.getByText('2/4')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Jane Rival candidate profile/i }),
    ).toBeInTheDocument()
  })
})
