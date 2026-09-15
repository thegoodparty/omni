import { describe, expect, it } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { fireEvent, screen } from '@testing-library/react'
import type { OutreachOrg } from '../data/stepProtocol'
import OrgsCard from './OrgsCard'

const org = (overrides: Partial<OutreachOrg> = {}): OutreachOrg => ({
  name: 'Families of Asheville City Schools',
  why: 'Reaches parents who are not in the contact file',
  askFor: 'Christina Shimrock or current leadership',
  script: 'Can we coordinate on the capital ask?',
  email: null,
  phone: null,
  url: null,
  ...overrides,
})

const openSheet = (o: OutreachOrg): void => {
  render(<OrgsCard orgs={[o]} />)
  fireEvent.click(screen.getByText(o.name))
}

describe('OrgsCard', () => {
  it('leads with a call when there is a number to call', () => {
    openSheet(org({ phone: '(828) 555-0134', email: 'hi@facs.org' }))
    const call = screen.getByRole('link', { name: /Call Families/ })
    // Punctuation a dialler cannot use is stripped, the way the phone
    // banking panel does it.
    expect(call).toHaveAttribute('href', 'tel:8285550134')
  })

  it('falls to email when there is no number, with the script written in', () => {
    openSheet(org({ email: 'hi@facs.org' }))
    const email = screen.getByRole('link', { name: /Email Families/ })
    const href = email.getAttribute('href') ?? ''
    expect(href).toContain('mailto:hi@facs.org')
    expect(href).toContain(encodeURIComponent('Can we coordinate'))
  })

  it('offers their site when the agent found no way to contact them', () => {
    // The honest fallback: it refused to invent an address, so the action is
    // to go and find one.
    openSheet(org({ url: 'https://facs.example' }))
    expect(
      screen.getByRole('link', { name: /Find their contact details/ }),
    ).toHaveAttribute('href', 'https://facs.example')
  })

  it('keeps the site reachable when it is not the primary action', () => {
    openSheet(org({ phone: '828-555-0134', url: 'https://facs.example' }))
    expect(screen.getByRole('link', { name: /Call Families/ })).toBeVisible()
    expect(screen.getByRole('link', { name: /Their site/ })).toHaveAttribute(
      'href',
      'https://facs.example',
    )
  })

  it('shows what to ask for and what to say', () => {
    openSheet(org({ phone: '828-555-0134' }))
    expect(screen.getByText(/Christina Shimrock/)).toBeVisible()
    expect(
      screen.getByText(/Can we coordinate on the capital ask/),
    ).toBeVisible()
  })
})
