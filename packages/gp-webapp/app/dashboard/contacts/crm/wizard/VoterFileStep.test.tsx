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
        precincts={[]}
        onPrecinctsChange={vi.fn()}
        precinctOptions={{
          options: [],
          truncated: false,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }}
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
        precincts={[]}
        onPrecinctsChange={vi.fn()}
        precinctOptions={{
          options: [],
          truncated: false,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }}
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
        precincts={[]}
        onPrecinctsChange={vi.fn()}
        precinctOptions={{
          options: [],
          truncated: false,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }}
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
        precincts={[]}
        onPrecinctsChange={vi.fn()}
        precinctOptions={{
          options: [],
          truncated: false,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }}
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

  it('does not render the section for an elected official (Win-only)', () => {
    render(
      <VoterFileStep
        filters={{}}
        onFiltersChange={noop}
        supportStatus={[]}
        precincts={[]}
        onPrecinctsChange={vi.fn()}
        precinctOptions={{
          options: [],
          truncated: false,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }}
        onSupportStatusChange={noop}
        isElectedOfficial
      />,
    )

    const headings = screen
      .getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent)

    expect(headings).not.toContain('Voter likelihood')
    expect(headings).not.toContain('Political party')
    expect(
      screen.queryByRole('toolbar', { name: 'Voter Likelihood' }),
    ).not.toBeInTheDocument()
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
        precincts={[]}
        onPrecinctsChange={vi.fn()}
        precinctOptions={{
          options: [],
          truncated: false,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }}
        onSupportStatusChange={noop}
        isElectedOfficial={false}
      />,
    )

    const headings = screen
      .getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent)

    expect(headings).toEqual([
      'Prior contacts made',
      'Support status',
      'Voter likelihood',
      'Political party',
      'Age',
      'Marital status',
      'Children',
      'Veteran status',
      'Homeownership',
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

  it('renders the same order minus the Win-only groups for Serve', () => {
    render(
      <VoterFileStep
        filters={{}}
        onFiltersChange={noop}
        supportStatus={[]}
        precincts={[]}
        onPrecinctsChange={vi.fn()}
        precinctOptions={{
          options: [],
          truncated: false,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }}
        onSupportStatusChange={noop}
        isElectedOfficial
      />,
    )

    const headings = screen
      .getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent)

    expect(headings).toEqual([
      'Support status',
      'Age',
      'Marital status',
      'Children',
      'Veteran status',
      'Homeownership',
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
        precincts={[]}
        onPrecinctsChange={vi.fn()}
        precinctOptions={{
          options: [],
          truncated: false,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }}
        onSupportStatusChange={noop}
        isElectedOfficial={false}
      />,
    )

    const headings = screen
      .getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent)

    const contactsMadeIndex = headings.indexOf('Prior contacts made')
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
        precincts={[]}
        onPrecinctsChange={vi.fn()}
        precinctOptions={{
          options: [],
          truncated: false,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }}
        onSupportStatusChange={noop}
        isElectedOfficial={false}
      />,
    )

    const contactsMadeGroup = screen.getByRole('toolbar', {
      name: 'Prior Contacts Made',
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
        precincts={[]}
        onPrecinctsChange={vi.fn()}
        precinctOptions={{
          options: [],
          truncated: false,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }}
        onSupportStatusChange={noop}
        isElectedOfficial={false}
      />,
    )

    const contactsMadeGroup = screen.getByRole('toolbar', {
      name: 'Prior Contacts Made',
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
        precincts={[]}
        onPrecinctsChange={vi.fn()}
        precinctOptions={{
          options: [],
          truncated: false,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }}
        onSupportStatusChange={noop}
        isElectedOfficial
      />,
    )

    const headings = screen
      .getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent)
    expect(headings).not.toContain('Prior contacts made')
    expect(
      screen.queryByRole('toolbar', { name: 'Prior Contacts Made' }),
    ).not.toBeInTheDocument()
  })
})

// ENG-10948: per-group "Select all" — every multi-option group header gets a
// Select all / Clear affordance; single-option groups (cell_phone, landline)
// don't, since there's nothing to bulk-toggle.
describe('VoterFileStep — per-group Select all', () => {
  const noop = vi.fn()

  // Finds the field's own header row (heading + the optional Select
  // all/Clear button) so assertions don't collide with the same option
  // labels ("Unknown", etc.) repeated across other groups.
  const headerRowFor = (fieldLabel: string) => {
    const heading = screen.getByRole('heading', {
      name: new RegExp(`^${fieldLabel}$`, 'i'),
    })
    const headerRow = heading.parentElement
    if (!headerRow) throw new Error(`${fieldLabel} header row not rendered`)
    return headerRow
  }

  it('selects every option of a multi-option group and reports them all via onFiltersChange', async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()

    render(
      <VoterFileStep
        filters={{}}
        onFiltersChange={onFiltersChange}
        supportStatus={[]}
        onSupportStatusChange={noop}
        precincts={[]}
        onPrecinctsChange={vi.fn()}
        precinctOptions={{
          options: [],
          truncated: false,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }}
        isElectedOfficial={false}
      />,
    )

    await user.click(
      within(headerRowFor('Ethnicity')).getByRole('button', {
        name: /select all/i,
      }),
    )

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({
        ethnicityAfricanAmerican: true,
        ethnicityAsian: true,
        ethnicityEuropean: true,
        ethnicityHispanic: true,
        ethnicityOther: true,
        ethnicityUnknown: true,
      }),
    )
  })

  it('toggles to Clear once every option is selected, and Clear deselects them all', async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()

    render(
      <VoterFileStep
        filters={{
          ethnicityAfricanAmerican: true,
          ethnicityAsian: true,
          ethnicityEuropean: true,
          ethnicityHispanic: true,
          ethnicityOther: true,
          ethnicityUnknown: true,
        }}
        onFiltersChange={onFiltersChange}
        supportStatus={[]}
        onSupportStatusChange={noop}
        precincts={[]}
        onPrecinctsChange={vi.fn()}
        precinctOptions={{
          options: [],
          truncated: false,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }}
        isElectedOfficial={false}
      />,
    )

    const clearButton = within(headerRowFor('Ethnicity')).getByRole('button', {
      name: 'Clear',
    })
    await user.click(clearButton)

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({
        ethnicityAfricanAmerican: false,
        ethnicityAsian: false,
        ethnicityEuropean: false,
        ethnicityHispanic: false,
        ethnicityOther: false,
        ethnicityUnknown: false,
      }),
    )
  })

  it('shows no Select all button for a single-option group (Cell phone, Landline)', () => {
    render(
      <VoterFileStep
        filters={{}}
        onFiltersChange={noop}
        supportStatus={[]}
        onSupportStatusChange={noop}
        precincts={[]}
        onPrecinctsChange={vi.fn()}
        precinctOptions={{
          options: [],
          truncated: false,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }}
        isElectedOfficial={false}
      />,
    )

    expect(
      within(headerRowFor('Cell phone')).queryByRole('button', {
        name: /select all/i,
      }),
    ).not.toBeInTheDocument()
    expect(
      within(headerRowFor('Landline')).queryByRole('button', {
        name: /select all/i,
      }),
    ).not.toBeInTheDocument()
  })

  it('Support status also gets Select all / Clear', async () => {
    const user = userEvent.setup()
    const onSupportStatusChange = vi.fn()

    render(
      <VoterFileStep
        filters={{}}
        onFiltersChange={noop}
        supportStatus={[]}
        onSupportStatusChange={onSupportStatusChange}
        precincts={[]}
        onPrecinctsChange={vi.fn()}
        precinctOptions={{
          options: [],
          truncated: false,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }}
        isElectedOfficial={false}
      />,
    )

    await user.click(
      within(headerRowFor('Support status')).getByRole('button', {
        name: /select all/i,
      }),
    )

    expect(onSupportStatusChange).toHaveBeenCalledWith([
      'supporter',
      'non_supporter',
      'undecided',
      'refused',
      'unknown',
    ] as SupportStatusRollup[])
  })

  it('toggles Support status to Clear once every pill is selected', async () => {
    const user = userEvent.setup()
    const onSupportStatusChange = vi.fn()

    render(
      <VoterFileStep
        filters={{}}
        onFiltersChange={noop}
        supportStatus={
          [
            'supporter',
            'non_supporter',
            'undecided',
            'refused',
            'unknown',
          ] as SupportStatusRollup[]
        }
        onSupportStatusChange={onSupportStatusChange}
        precincts={[]}
        onPrecinctsChange={vi.fn()}
        precinctOptions={{
          options: [],
          truncated: false,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }}
        isElectedOfficial={false}
      />,
    )

    await user.click(
      within(headerRowFor('Support status')).getByRole('button', {
        name: 'Clear',
      }),
    )

    expect(onSupportStatusChange).toHaveBeenCalledWith([])
  })
})
// The recommended-lists groundwork dimensions. Gated on
// win-recommended-lists (resolved by CreateListWizard and passed in as a
// prop), so the default-off path is what every other caller of this step —
// the outreach v2 builders — keeps rendering.
describe('VoterFileStep — recommended-list filter groups', () => {
  const renderStep = (
    props: Partial<{
      filters: Record<string, boolean>
      onFiltersChange: (filters: Record<string, boolean>) => void
      isElectedOfficial: boolean
      showRecommendedListFilters: boolean
    }> = {},
  ) =>
    render(
      <VoterFileStep
        filters={props.filters ?? {}}
        onFiltersChange={props.onFiltersChange ?? vi.fn()}
        supportStatus={[]}
        onSupportStatusChange={vi.fn()}
        precincts={[]}
        onPrecinctsChange={vi.fn()}
        precinctOptions={{
          options: [],
          truncated: false,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }}
        isElectedOfficial={props.isElectedOfficial ?? false}
        showRecommendedListFilters={props.showRecommendedListFilters ?? false}
      />,
    )

  const headings = () =>
    screen
      .getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent)

  it('hides all three groups when the flag is off', () => {
    renderStep()

    expect(headings()).not.toContain('Independent affinity')
    expect(headings()).not.toContain('Ideology')
    expect(screen.queryByText('Has Any Phone')).not.toBeInTheDocument()
  })

  it('renders all three groups when the flag is on', () => {
    renderStep({ showRecommendedListFilters: true })

    expect(headings()).toContain('Independent affinity')
    expect(headings()).toContain('Ideology')
    expect(screen.getByText('Open to Independents')).toBeInTheDocument()
    expect(screen.getByText('Has Any Phone')).toBeInTheDocument()
  })

  // The mart column says Liberal; house copy says Progressive. The pill
  // shows the copy and the persisted key follows the data.
  it('labels the Liberal bucket Progressive and offers Unknown', async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()
    renderStep({ showRecommendedListFilters: true, onFiltersChange })

    expect(screen.queryByText('Liberal')).not.toBeInTheDocument()
    await user.click(screen.getByText('Progressive'))

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ ideologyLiberal: true }),
    )

    const ideologyGroup = screen.getByLabelText('Ideology')
    expect(within(ideologyGroup).getByText('Unknown')).toBeInTheDocument()
  })

  // Win-only for the same reason political party is: gp-api 400s both an
  // affinity and an ideology filter for an eo- org. Any-phone survives —
  // plain contactability, and Serve runs phone banking and robocall.
  it('hides affinity and ideology for a Serve organization', () => {
    renderStep({ showRecommendedListFilters: true, isElectedOfficial: true })

    expect(headings()).not.toContain('Independent affinity')
    expect(headings()).not.toContain('Ideology')
    expect(screen.getByText('Has Any Phone')).toBeInTheDocument()
  })

  it('clears the cell/landline picks when Has Any Phone is selected', async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()
    renderStep({
      showRecommendedListFilters: true,
      filters: { hasCellPhone: true, hasLandline: true },
      onFiltersChange,
    })

    await user.click(screen.getByText('Has Any Phone'))

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({
        hasAnyPhone: true,
        hasCellPhone: false,
        hasLandline: false,
      }),
    )
  })

  it('clears Has Any Phone when a specific phone type is selected', async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()
    renderStep({
      showRecommendedListFilters: true,
      filters: { hasAnyPhone: true },
      onFiltersChange,
    })

    await user.click(screen.getByText('Has Cell Phone'))

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ hasAnyPhone: false, hasCellPhone: true }),
    )
  })
})
