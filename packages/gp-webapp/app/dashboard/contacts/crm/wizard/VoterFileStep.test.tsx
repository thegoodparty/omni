import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import VoterFileStep from './VoterFileStep'

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
