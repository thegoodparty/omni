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
    ;['Unknown', 'First Time', 'Unlikely', 'Likely', 'Super'].forEach(
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
