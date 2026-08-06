import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useQuery } from '@tanstack/react-query'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useCrmEnabled } from '../../../shared/useCrmEnabled'
import { useOrganization } from '@shared/organization-picker'
import { useSnackbar } from 'helpers/useSnackbar'
import StatusRow from './StatusRow'
import { makePerson } from '../shared/test-fixtures'
import type { Person, UpdateContactStatusInput } from '../shared/contacts-types'

vi.mock('../../../shared/useCrmEnabled', () => ({
  useCrmEnabled: vi.fn(),
}))

vi.mock('@shared/organization-picker', () => ({
  useOrganization: vi.fn(),
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: vi.fn(),
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const mockedUseCrmEnabled = vi.mocked(useCrmEnabled)
const mockedUseOrganization = vi.mocked(useOrganization)
const mockedUseSnackbar = vi.mocked(useSnackbar)

const ORG_SLUG = 'org-1'
const PERSON_ID = 'p_1'

const errorSnackbar = vi.fn()
const successSnackbar = vi.fn()
const displaySnackbar = vi.fn()

// Mirrors ContactsTableProvider's personQuery: subscribes to the exact key
// StatusRow's mutations write to, so an optimistic write/rollback is
// observable the same way it is in the real overlay (StatusRow reads its
// displayed values from the `person` prop, not from its own query — the
// cache write only becomes visible once a subscriber like this re-renders it
// with fresh data).
function Harness({
  initialPerson,
  hidePoliticalParty = false,
}: {
  initialPerson: Person
  hidePoliticalParty?: boolean
}) {
  const { data: person } = useQuery({
    queryKey: ['person', ORG_SLUG, initialPerson.id],
    queryFn: () => initialPerson,
    initialData: initialPerson,
    staleTime: Infinity,
  })
  return <StatusRow person={person!} hidePoliticalParty={hidePoliticalParty} />
}

describe('<StatusRow>', () => {
  beforeEach(() => {
    mockedUseCrmEnabled.mockReset()
    mockedUseOrganization.mockReset()
    mockedUseSnackbar.mockReset()
    vi.mocked(trackEvent).mockClear()
    errorSnackbar.mockClear()
    successSnackbar.mockClear()
    displaySnackbar.mockClear()

    mockedUseCrmEnabled.mockReturnValue({ ready: true, enabled: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedUseOrganization.mockReturnValue({ slug: ORG_SLUG } as any)
    mockedUseSnackbar.mockReturnValue({
      displaySnackbar,
      errorSnackbar,
      successSnackbar,
    })
  })

  it('renders both dropdowns and the opt-in pill for Win + CRM-on', () => {
    const person = makePerson({
      voterLikelihood: 'likely',
      supportStatus: 'supporter',
      optedOutAt: null,
    })

    render(<Harness initialPerson={person} />)

    expect(
      screen.getByRole('combobox', { name: 'Voter Likelihood' }),
    ).toHaveTextContent('Likely')
    expect(
      screen.getByRole('combobox', { name: 'Support Status' }),
    ).toHaveTextContent('Supporter')
    expect(screen.getByText('Opted In')).toBeInTheDocument()
  })

  it('defaults both statuses to Unknown when absent from the person payload', () => {
    const person = makePerson()

    render(<Harness initialPerson={person} />)

    expect(
      screen.getByRole('combobox', { name: 'Voter Likelihood' }),
    ).toHaveTextContent('Unknown')
    expect(
      screen.getByRole('combobox', { name: 'Support Status' }),
    ).toHaveTextContent('Unknown')
  })

  it('renders nothing for Serve (hidePoliticalParty) even when CRM is enabled', () => {
    const person = makePerson()

    const { container } = render(
      <Harness initialPerson={person} hidePoliticalParty />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing while the CRM gate is not enabled', () => {
    mockedUseCrmEnabled.mockReturnValue({ ready: true, enabled: false })
    const person = makePerson()

    const { container } = render(<Harness initialPerson={person} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing while the CRM gate is not ready', () => {
    mockedUseCrmEnabled.mockReturnValue({ ready: false, enabled: false })
    const person = makePerson()

    const { container } = render(<Harness initialPerson={person} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('the opt-in pill reflects optedOutAt and has no interactive role', () => {
    const person = makePerson({ optedOutAt: '2026-07-10T12:00:00.000Z' })

    render(<Harness initialPerson={person} />)

    const pill = screen.getByText('Opted Out')
    expect(pill.closest('button')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /opted/i }),
    ).not.toBeInTheDocument()
  })

  it('renders both dropdown menus above the person-overlay sheet (z-[1400])', async () => {
    const user = userEvent.setup()

    render(<Harness initialPerson={makePerson()} />)

    await user.click(screen.getByRole('combobox', { name: 'Voter Likelihood' }))
    expect(await screen.findByRole('listbox')).toHaveClass('z-[1400]')
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('combobox', { name: 'Support Status' }))
    expect(await screen.findByRole('listbox')).toHaveClass('z-[1400]')
  })

  it('changing Voter Likelihood PATCHes the right body, optimistically updates, and fires the event once', async () => {
    const user = userEvent.setup()
    const person = makePerson({ voterLikelihood: 'unknown' })
    let patchCallCount = 0
    let lastPatchBody: UpdateContactStatusInput | null = null
    api.mock('PATCH /v1/contacts/:personId/status', ({ body }) => {
      patchCallCount += 1
      lastPatchBody = body
      return {
        status: 200,
        data: { voterLikelihood: 'super', supportStatus: 'unknown' },
      }
    })

    render(<Harness initialPerson={person} />)

    await user.click(screen.getByRole('combobox', { name: 'Voter Likelihood' }))
    await user.click(await screen.findByRole('option', { name: 'Super' }))

    // Optimistic: the trigger reflects the new value before the PATCH settles.
    expect(
      screen.getByRole('combobox', { name: 'Voter Likelihood' }),
    ).toHaveTextContent('Super')

    await waitFor(() => expect(patchCallCount).toBe(1))
    expect(lastPatchBody).toEqual({ field: 'voter_likelihood', value: 'super' })

    await waitFor(() => expect(trackEvent).toHaveBeenCalledTimes(1))
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.VoterData.ContactStatusChanged,
      { field: 'voter_likelihood', from: 'unknown', to: 'super' },
    )
  })

  it('changing Support Status PATCHes the right body and optimistically updates', async () => {
    const user = userEvent.setup()
    const person = makePerson({ supportStatus: 'undecided' })
    let lastPatchBody: UpdateContactStatusInput | null = null
    api.mock('PATCH /v1/contacts/:personId/status', ({ body }) => {
      lastPatchBody = body
      return {
        status: 200,
        data: { voterLikelihood: 'unknown', supportStatus: 'refused' },
      }
    })

    render(<Harness initialPerson={person} />)

    await user.click(screen.getByRole('combobox', { name: 'Support Status' }))
    await user.click(await screen.findByRole('option', { name: 'Refused' }))

    expect(
      screen.getByRole('combobox', { name: 'Support Status' }),
    ).toHaveTextContent('Refused')

    await waitFor(() =>
      expect(lastPatchBody).toEqual({
        field: 'support_status',
        value: 'refused',
      }),
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.VoterData.ContactStatusChanged,
      { field: 'support_status', from: 'undecided', to: 'refused' },
    )
  })

  it('reselecting the already-current value is a no-op — no PATCH, no event', async () => {
    const user = userEvent.setup()
    const person = makePerson({ voterLikelihood: 'likely' })
    let patchCallCount = 0
    api.mock('PATCH /v1/contacts/:personId/status', () => {
      patchCallCount += 1
      return {
        status: 200,
        data: { voterLikelihood: 'likely', supportStatus: 'unknown' },
      }
    })

    render(<Harness initialPerson={person} />)

    await user.click(screen.getByRole('combobox', { name: 'Voter Likelihood' }))
    await user.click(await screen.findByRole('option', { name: 'Likely' }))

    expect(patchCallCount).toBe(0)
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('reverts the value and shows an error snackbar when the PATCH fails', async () => {
    const user = userEvent.setup()
    const person = makePerson({ voterLikelihood: 'unknown' })
    api.mock('PATCH /v1/contacts/:personId/status', {
      status: 500,
      data: { message: 'boom' },
    })

    render(<Harness initialPerson={person} />)

    await user.click(screen.getByRole('combobox', { name: 'Voter Likelihood' }))
    await user.click(await screen.findByRole('option', { name: 'Super' }))

    // The optimistic update (asserted in the success-path test above) is
    // immediately followed by a rollback once the failed PATCH resolves — by
    // the time the interaction settles, the value is back to its original.
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'Voter Likelihood' }),
      ).toHaveTextContent('Unknown'),
    )
    expect(errorSnackbar).toHaveBeenCalledTimes(1)
    expect(trackEvent).not.toHaveBeenCalled()
    expect(
      testQueryClient.getQueryData<Person>(['person', ORG_SLUG, PERSON_ID]),
    ).toMatchObject({ voterLikelihood: 'unknown' })
  })

  it('a failed voter_likelihood rollback does not clobber a support_status change that already committed', async () => {
    const user = userEvent.setup()
    const person = makePerson({
      voterLikelihood: 'unknown',
      supportStatus: 'undecided',
    })

    // voter_likelihood's PATCH hangs on this gate until released below, then
    // rejects. support_status's PATCH resolves immediately. This reproduces
    // the two-quick-changes race: support_status commits first while
    // voter_likelihood is still in flight, then voter_likelihood's rollback
    // must not clobber the field it doesn't own.
    let releaseVoterLikelihoodGate: () => void
    const voterLikelihoodGate = new Promise<void>((resolve) => {
      releaseVoterLikelihoodGate = resolve
    })
    api.mock('PATCH /v1/contacts/:personId/status', async ({ body }) => {
      if (body.field === 'voter_likelihood') {
        await voterLikelihoodGate
        return { status: 500, data: { message: 'boom' } }
      }
      return {
        status: 200,
        data: { voterLikelihood: 'unknown', supportStatus: body.value },
      }
    })

    render(<Harness initialPerson={person} />)

    // Start the voter_likelihood change — its PATCH hangs on the gate.
    await user.click(screen.getByRole('combobox', { name: 'Voter Likelihood' }))
    await user.click(await screen.findByRole('option', { name: 'Super' }))
    expect(
      screen.getByRole('combobox', { name: 'Voter Likelihood' }),
    ).toHaveTextContent('Super')

    // Before it resolves, change support_status — its PATCH resolves and
    // commits right away.
    await user.click(screen.getByRole('combobox', { name: 'Support Status' }))
    await user.click(await screen.findByRole('option', { name: 'Refused' }))
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'Support Status' }),
      ).toHaveTextContent('Refused'),
    )

    // Now let voter_likelihood's PATCH reject.
    releaseVoterLikelihoodGate!()

    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'Voter Likelihood' }),
      ).toHaveTextContent('Unknown'),
    )
    // The already-committed Support Status change must survive the rollback.
    expect(
      screen.getByRole('combobox', { name: 'Support Status' }),
    ).toHaveTextContent('Refused')
    expect(
      testQueryClient.getQueryData<Person>(['person', ORG_SLUG, PERSON_ID]),
    ).toMatchObject({ voterLikelihood: 'unknown', supportStatus: 'refused' })
  })
})
