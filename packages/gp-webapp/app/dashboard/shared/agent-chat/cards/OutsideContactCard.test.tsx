import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import type { ChatCard } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { ChatCardRenderer } from './ChatCardRenderer'

const SCRIPT = 'Calling about 14 Mill St. Can you tell me who owns the parcel?'

const contactCard = (
  overrides: Partial<Extract<ChatCard, { kind: 'outside_contact' }>> = {},
): ChatCard => ({
  kind: 'outside_contact',
  name: "Dale County Attorney's Office",
  role: 'County attorney',
  why: 'They own the nuisance ordinance the complaints fall under.',
  askFor: 'The code enforcement division',
  script: SCRIPT,
  email: 'clerk@dalecounty.gov',
  phone: '(937) 555-0142',
  url: 'https://dalecounty.gov/attorney',
  ...overrides,
})

const renderCard = (card: ChatCard) =>
  render(
    <ChatCardRenderer
      card={card}
      priorityId="priority-1"
      conversationId="conversation-1"
    />,
  )

describe('OutsideContactCard', () => {
  it('dials the phone, opens the email already written, and links the site', () => {
    renderCard(contactCard())

    expect(screen.getByRole('link', { name: /Call/ })).toHaveAttribute(
      'href',
      'tel:9375550142',
    )
    expect(screen.getByRole('link', { name: /Email/ })).toHaveAttribute(
      'href',
      `mailto:clerk@dalecounty.gov?body=${encodeURIComponent(SCRIPT)}`,
    )
    expect(
      screen.getByRole('link', { name: /Visit their site/ }),
    ).toHaveAttribute('href', 'https://dalecounty.gov/attorney')
  })

  it('shows the name, why, who to ask for, and the script to read out', () => {
    renderCard(contactCard())

    expect(
      screen.getByText("Dale County Attorney's Office"),
    ).toBeInTheDocument()
    expect(screen.getByText('County attorney')).toBeInTheDocument()
    expect(
      screen.getByText(
        'They own the nuisance ordinance the complaints fall under.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('The code enforcement division'),
    ).toBeInTheDocument()
    expect(screen.getByText(SCRIPT)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Copy script/ }),
    ).toBeInTheDocument()
  })

  it('renders only the routes the agent actually found', () => {
    renderCard(contactCard({ phone: null, url: null }))

    expect(screen.queryByRole('link', { name: /Call/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Visit their site/ })).toBeNull()
    expect(screen.getByRole('link', { name: /Email/ })).toBeInTheDocument()
  })

  it('still renders the script when there is no way to reach them', () => {
    renderCard(contactCard({ phone: null, email: null, url: null }))

    expect(screen.getByText(SCRIPT)).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
