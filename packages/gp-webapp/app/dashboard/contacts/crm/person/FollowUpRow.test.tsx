import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useQuery } from '@tanstack/react-query'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useOrganization } from '@shared/organization-picker'
import { useSnackbar } from 'helpers/useSnackbar'
import FollowUpRow from './FollowUpRow'
import { makePerson } from '../shared/test-fixtures'
import type { Person, UpdateFollowUpInput } from '../shared/contacts-types'

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

const mockedUseOrganization = vi.mocked(useOrganization)
const mockedUseSnackbar = vi.mocked(useSnackbar)

const ORG_SLUG = 'eo-org-1'
const PERSON_ID = 'p_1'
const TOGGLE = 'Asked for follow-up'

const errorSnackbar = vi.fn()
const successSnackbar = vi.fn()
const displaySnackbar = vi.fn()

// Mirrors ContactsTableProvider's personQuery so the optimistic cache write
// is observable the same way it is in the real overlay — the row reads its
// displayed value from the `person` prop, not from its own query.
function Harness({
  initialPerson,
  isServe = true,
}: {
  initialPerson: Person
  isServe?: boolean
}) {
  const { data: person } = useQuery({
    queryKey: ['person', ORG_SLUG, initialPerson.id],
    queryFn: () => initialPerson,
    initialData: initialPerson,
    staleTime: Infinity,
  })
  return <FollowUpRow person={person!} isServe={isServe} />
}

describe('<FollowUpRow>', () => {
  beforeEach(() => {
    mockedUseOrganization.mockReset()
    mockedUseSnackbar.mockReset()
    vi.mocked(trackEvent).mockClear()
    errorSnackbar.mockClear()
    successSnackbar.mockClear()
    displaySnackbar.mockClear()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedUseOrganization.mockReturnValue({ slug: ORG_SLUG } as any)
    mockedUseSnackbar.mockReturnValue({
      displaySnackbar,
      errorSnackbar,
      successSnackbar,
    })
  })

  it('renders nothing for Win', () => {
    render(
      <Harness
        initialPerson={makePerson({ followUp: 'requested' })}
        isServe={false}
      />,
    )

    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('reads off when the person payload carries no follow-up', () => {
    render(<Harness initialPerson={makePerson()} />)

    expect(screen.getByRole('switch', { name: TOGGLE })).not.toBeChecked()
  })

  it('reads on when the flag is requested', () => {
    render(<Harness initialPerson={makePerson({ followUp: 'requested' })} />)

    expect(screen.getByRole('switch', { name: TOGGLE })).toBeChecked()
  })

  it('turning it on PATCHes requested, optimistically updates, and fires the event once', async () => {
    const user = userEvent.setup()
    let patchCallCount = 0
    let lastPatchBody: UpdateFollowUpInput | null = null
    api.mock('PATCH /v1/contacts/:personId/follow-up', ({ body }) => {
      patchCallCount += 1
      lastPatchBody = body
      return { status: 200, data: { followUp: 'requested' } }
    })

    render(<Harness initialPerson={makePerson({ followUp: 'cleared' })} />)

    await user.click(screen.getByRole('switch', { name: TOGGLE }))

    expect(screen.getByRole('switch', { name: TOGGLE })).toBeChecked()

    await waitFor(() => expect(patchCallCount).toBe(1))
    expect(lastPatchBody).toEqual({ value: 'requested' })

    await waitFor(() => expect(trackEvent).toHaveBeenCalledTimes(1))
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ConstituentData.FollowUpChanged,
      { from: 'cleared', to: 'requested' },
    )
  })

  it('turning it off PATCHes cleared — lifting the flag is its own write', async () => {
    const user = userEvent.setup()
    let lastPatchBody: UpdateFollowUpInput | null = null
    api.mock('PATCH /v1/contacts/:personId/follow-up', ({ body }) => {
      lastPatchBody = body
      return { status: 200, data: { followUp: 'cleared' } }
    })

    render(<Harness initialPerson={makePerson({ followUp: 'requested' })} />)

    await user.click(screen.getByRole('switch', { name: TOGGLE }))

    await waitFor(() => expect(lastPatchBody).toEqual({ value: 'cleared' }))
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.ConstituentData.FollowUpChanged,
      { from: 'requested', to: 'cleared' },
    )
  })

  it('reverts and shows an error snackbar when the PATCH fails', async () => {
    const user = userEvent.setup()
    api.mock('PATCH /v1/contacts/:personId/follow-up', {
      status: 500,
      data: { message: 'boom' },
    })

    render(<Harness initialPerson={makePerson({ followUp: 'cleared' })} />)

    await user.click(screen.getByRole('switch', { name: TOGGLE }))

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: TOGGLE })).not.toBeChecked(),
    )
    expect(errorSnackbar).toHaveBeenCalledTimes(1)
    expect(trackEvent).not.toHaveBeenCalled()
    expect(
      testQueryClient.getQueryData<Person>(['person', ORG_SLUG, PERSON_ID]),
    ).toMatchObject({ followUp: 'cleared' })
  })
})
