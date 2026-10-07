import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChatCard } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { ChatCardRenderer } from './ChatCardRenderer'
import { initialsOf } from './cardShell'

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

const renderCard = (card: ChatCard) => render(<ChatCardRenderer card={card} />)

const openCard = async (card: ChatCard) => {
  renderCard(card)
  await userEvent.click(
    screen.getByRole('button', { name: /Dale County Attorney's Office/ }),
  )
  return within(await screen.findByRole('dialog'))
}

describe('OutsideContactCard', () => {
  it('sits in the stream as one row: the name and one line on who they are', () => {
    renderCard(contactCard())

    const chip = screen.getByRole('button', {
      name: /Dale County Attorney's Office/,
    })
    expect(chip).toHaveAttribute('aria-expanded', 'false')
    expect(within(chip).getByText('County attorney')).toBeInTheDocument()
    expect(
      screen.queryByText(
        'They own the nuisance ordinance the complaints fall under.',
      ),
    ).toBeNull()
    // The detail stays out of the stream until it is asked for.
    expect(screen.queryByText(SCRIPT)).toBeNull()
    expect(screen.queryByRole('link', { name: /Call/ })).toBeNull()
  })

  it('dials the phone, opens the email already written, and links the site', async () => {
    const panel = await openCard(contactCard())

    expect(panel.getByRole('link', { name: /Call/ })).toHaveAttribute(
      'href',
      'tel:9375550142',
    )
    expect(panel.getByRole('link', { name: /Email/ })).toHaveAttribute(
      'href',
      `mailto:clerk@dalecounty.gov?body=${encodeURIComponent(SCRIPT)}`,
    )
    expect(
      panel.getByRole('link', { name: /Visit their site/ }),
    ).toHaveAttribute('href', 'https://dalecounty.gov/attorney')
  })

  it('shows the name, why, who to ask for, and the script to read out', async () => {
    const panel = await openCard(contactCard())

    expect(
      panel.getByRole('heading', { name: "Dale County Attorney's Office" }),
    ).toBeInTheDocument()
    expect(panel.getByText('County attorney')).toBeInTheDocument()
    expect(
      panel.getByText(
        'They own the nuisance ordinance the complaints fall under.',
      ),
    ).toBeInTheDocument()
    expect(panel.getByText('The code enforcement division')).toBeInTheDocument()
    expect(panel.getByText(SCRIPT)).toBeInTheDocument()
    expect(
      panel.getByRole('button', { name: /Copy script/ }),
    ).toBeInTheDocument()
  })

  it('renders only the routes the agent actually found', async () => {
    const panel = await openCard(contactCard({ phone: null, url: null }))

    expect(panel.queryByRole('link', { name: /Call/ })).toBeNull()
    expect(panel.queryByRole('link', { name: /Visit their site/ })).toBeNull()
    expect(panel.getByRole('link', { name: /Email/ })).toBeInTheDocument()
  })

  it('still renders the script when there is no way to reach them', async () => {
    const panel = await openCard(
      contactCard({ phone: null, email: null, url: null }),
    )

    expect(panel.getByText(SCRIPT)).toBeInTheDocument()
    expect(panel.queryByRole('link')).toBeNull()
  })
})

describe('initialsOf', () => {
  it.each([
    ['Mark Matheny', 'MM'],
    ["Dale County Attorney's Office", 'DC'],
    ['(Riverside) Parks & Rec', 'RP'],
    ['Cher', 'C'],
  ])('reads %s as %s', (name, initials) => {
    expect(initialsOf(name)).toBe(initials)
  })
})
