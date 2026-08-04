import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import VoterFileStep from './VoterFileStep'
import type { SupportStatusRollup } from '../shared/contacts-types'

// ENG-10837: the Support status section shows all five SupportStatusRollup
// values (product decision 2026-07-28) — the prototype's 3-pill section is
// deliberately superseded, not "fixed back".
describe('VoterFileStep — Support status pills', () => {
  it('renders Supporter, Non-supporter, Undecided, Refused, and Support Unknown', () => {
    render(
      <VoterFileStep
        filters={{}}
        onFiltersChange={vi.fn()}
        supportStatus={[]}
        onSupportStatusChange={vi.fn()}
        isElectedOfficial={false}
      />,
    )

    for (const label of [
      'Supporter',
      'Non-supporter',
      'Undecided',
      'Refused',
      'Support Unknown',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('toggling Undecided reports it via onSupportStatusChange', async () => {
    const user = userEvent.setup()
    const onSupportStatusChange = vi.fn()

    render(
      <VoterFileStep
        filters={{}}
        onFiltersChange={vi.fn()}
        supportStatus={[]}
        onSupportStatusChange={onSupportStatusChange}
        isElectedOfficial={false}
      />,
    )

    await user.click(screen.getByText('Undecided'))

    expect(onSupportStatusChange).toHaveBeenCalledWith([
      'undecided',
    ] as SupportStatusRollup[])
  })
})

// ENG-10838: Voter Likelihood moves to render directly below Support status
// in the wizard (a wizard-only rendering change — filters.config.ts's
// section/field order is untouched, so the legacy flag-off page, which
// renders that same config directly, is unaffected).
describe('VoterFileStep — Voter Likelihood section position', () => {
  const noop = vi.fn()

  it('renders the Voter Likelihood group heading directly below Support status', () => {
    render(
      <VoterFileStep
        filters={{}}
        onFiltersChange={noop}
        supportStatus={[]}
        onSupportStatusChange={noop}
        isElectedOfficial={false}
      />,
    )

    const headings = screen
      .getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent)

    const supportStatusIndex = headings.indexOf('Support status')
    const voterLikelihoodIndex = headings.indexOf('Voter likelihood')

    expect(supportStatusIndex).toBeGreaterThan(-1)
    expect(voterLikelihoodIndex).toBe(supportStatusIndex + 1)
  })

  it('still renders every Voter Likelihood option', () => {
    render(
      <VoterFileStep
        filters={{}}
        onFiltersChange={noop}
        supportStatus={[]}
        onSupportStatusChange={noop}
        isElectedOfficial={false}
      />,
    )

    const voterLikelihoodGroup = screen.getByRole('toolbar', {
      name: 'Voter Likelihood',
    })
    expect(voterLikelihoodGroup).toBeInTheDocument()
    ;['Unknown', 'Unlikely', 'Unreliable', 'Likely', 'Super'].forEach(
      (label) => {
        expect(
          within(voterLikelihoodGroup).getByRole('button', { name: label }),
        ).toBeInTheDocument()
      },
    )
  })

  it('renders the same for an elected official (Voter Likelihood is not party-gated)', () => {
    render(
      <VoterFileStep
        filters={{}}
        onFiltersChange={noop}
        supportStatus={[]}
        onSupportStatusChange={noop}
        isElectedOfficial
      />,
    )

    const headings = screen
      .getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent)
    const supportStatusIndex = headings.indexOf('Support status')
    const voterLikelihoodIndex = headings.indexOf('Voter likelihood')

    expect(voterLikelihoodIndex).toBe(supportStatusIndex + 1)
    expect(headings).not.toContain('Political party')
  })
})

// ENG-10847: the full filter list renders in the Lovable prototype's order —
// Contacts made, Support status, Voter likelihood first, demographics after,
// with the product-only fields the prototype doesn't have (Gender, Cell
// phone, Landline) trailing at the end.
describe('VoterFileStep — prototype filter order', () => {
  const noop = vi.fn()

  it('renders every filter group in the Lovable order for Win', () => {
    render(
      <VoterFileStep
        filters={{}}
        onFiltersChange={noop}
        supportStatus={[]}
        onSupportStatusChange={noop}
        isElectedOfficial={false}
      />,
    )

    const headings = screen
      .getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent)

    expect(headings).toEqual([
      'Contacts made',
      'Support status',
      'Voter likelihood',
      'Political party',
      'Age',
      'Marital status',
      'Children',
      'Veteran status',
      'Homeowner',
      'Business owner',
      'Level of education',
      'Household income range',
      'Language',
      'Ethnicity',
      'Gender',
      'Cell phone',
      'Landline',
    ])
  })

  it('renders the same order minus Contacts made and Political party for Serve', () => {
    render(
      <VoterFileStep
        filters={{}}
        onFiltersChange={noop}
        supportStatus={[]}
        onSupportStatusChange={noop}
        isElectedOfficial
      />,
    )

    const headings = screen
      .getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent)

    expect(headings).toEqual([
      'Support status',
      'Voter likelihood',
      'Age',
      'Marital status',
      'Children',
      'Veteran status',
      'Homeowner',
      'Business owner',
      'Level of education',
      'Household income range',
      'Language',
      'Ethnicity',
      'Gender',
      'Cell phone',
      'Landline',
    ])
  })
})

// ENG-10839: Contacts Made moves to render directly ABOVE Support status in
// the wizard (prototype order) — the opposite side from Voter Likelihood,
// which renders below. Win-only, stripped for Serve like Political Party.
describe('VoterFileStep — Contacts Made section', () => {
  const noop = vi.fn()

  it('renders the Contacts Made group heading directly above Support status', () => {
    render(
      <VoterFileStep
        filters={{}}
        onFiltersChange={noop}
        supportStatus={[]}
        onSupportStatusChange={noop}
        isElectedOfficial={false}
      />,
    )

    const headings = screen
      .getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent)

    const contactsMadeIndex = headings.indexOf('Contacts made')
    const supportStatusIndex = headings.indexOf('Support status')

    expect(contactsMadeIndex).toBeGreaterThan(-1)
    expect(contactsMadeIndex).toBe(supportStatusIndex - 1)
  })

  it('renders every Contacts Made option (0 through 5+)', () => {
    render(
      <VoterFileStep
        filters={{}}
        onFiltersChange={noop}
        supportStatus={[]}
        onSupportStatusChange={noop}
        isElectedOfficial={false}
      />,
    )

    const contactsMadeGroup = screen.getByRole('toolbar', {
      name: 'Contacts Made',
    })
    expect(contactsMadeGroup).toBeInTheDocument()
    ;['0', '1', '2', '3', '4', '5+'].forEach((label) => {
      expect(
        within(contactsMadeGroup).getByRole('button', { name: label }),
      ).toBeInTheDocument()
    })
  })

  it('toggling a pill reports it via onFiltersChange', async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()

    render(
      <VoterFileStep
        filters={{}}
        onFiltersChange={onFiltersChange}
        supportStatus={[]}
        onSupportStatusChange={noop}
        isElectedOfficial={false}
      />,
    )

    const contactsMadeGroup = screen.getByRole('toolbar', {
      name: 'Contacts Made',
    })
    await user.click(
      within(contactsMadeGroup).getByRole('button', { name: '0' }),
    )

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ contactsMade0: true }),
    )
  })

  it('does not render the section for an elected official (Win-only)', () => {
    render(
      <VoterFileStep
        filters={{}}
        onFiltersChange={noop}
        supportStatus={[]}
        onSupportStatusChange={noop}
        isElectedOfficial
      />,
    )

    const headings = screen
      .getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent)
    expect(headings).not.toContain('Contacts made')
    expect(
      screen.queryByRole('toolbar', { name: 'Contacts Made' }),
    ).not.toBeInTheDocument()
  })
})
