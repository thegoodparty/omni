import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CivicPanelComposition } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { CivicPanelNext } from './CivicPanelNext'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))
const errorSnackbar = vi.fn()
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar }),
}))
vi.mock('@shared/organization-picker', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOrganization: () => ({
    slug: 'eo-test',
    positionName: 'Mayor',
    district: { l2Name: 'City of Asheville' },
  }),
}))
const clientRequest = vi.fn()
vi.mock('gpApi/typed-request', () => ({
  clientRequest: (...args: object[]) => clientRequest(...args),
}))
vi.mock('app/dashboard/outreach/v2/phone-banking/PhoneBankingFlow', () => ({
  SERVE_PHONE_BANKING_SURFACE: {},
  PhoneBankingFlow: ({
    preselectedListId,
    initialName,
    civicPanelInvite,
  }: {
    preselectedListId: number
    initialName: string
    civicPanelInvite: { script: string }
  }) => (
    <div data-testid="phone-banking-flow">
      <span data-testid="list-id">{preselectedListId}</span>
      <span data-testid="list-name">{initialName}</span>
      <span data-testid="script">{civicPanelInvite.script}</span>
    </div>
  ),
}))

// One tract far behind, and residents 65 and over behind theirs.
const COMPOSITION: CivicPanelComposition = {
  placeKind: 'tract',
  places: [
    {
      key: '37021000100',
      name: '0001.00',
      label: 'around Pine St',
      districtShare: 0.5,
      members: 5,
    },
    { key: '37021000200', name: '0002.00', districtShare: 0.5, members: 45 },
  ],
  groups: [
    { group: 'age65plus', districtShare: 0.3, memberShare: 0.05 },
    { group: 'men', districtShare: 0.5, memberShare: 0.5 },
  ],
}

const renderNext = (exhausted = true) =>
  render(
    <CivicPanelNext
      composition={COMPOSITION}
      members={50}
      goal={100}
      exhausted={exhausted}
      place="Asheville"
    />,
  )

const rowOf = (name: string) => {
  const row = screen.getByText(name).closest('li')
  if (!row) throw new Error(`No row for ${name}`)
  return row
}

describe('CivicPanelNext, once every resident we can text has an invite', () => {
  beforeEach(() => {
    push.mockClear()
    errorSnackbar.mockClear()
    clientRequest.mockReset()
  })

  it('saves a door list of the tract and opens door knocking on it', async () => {
    clientRequest.mockResolvedValue({ data: { listId: 42, people: 300 } })
    renderNext()

    await userEvent.click(
      within(rowOf('Around Pine St')).getByRole('button', {
        name: 'Knock doors, Around Pine St',
      }),
    )

    expect(clientRequest).toHaveBeenCalledWith(
      'POST /v1/contacts/civic-panel/reach-lists',
      {
        group: { kind: 'tract', key: '37021000100' },
        channel: 'door',
        name: 'Knock doors: Around Pine St',
      },
    )
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        '/dashboard/door-knocking?create=1&listId=42&purpose=build_citizens_panel',
      ),
    )
  })

  it('saves a call list of an age group and opens phone banking on it', async () => {
    clientRequest.mockResolvedValue({ data: { listId: 7, people: 80 } })
    renderNext()

    await userEvent.click(
      within(rowOf('People 65 and over')).getByRole('button', {
        name: 'Call, People 65 and over',
      }),
    )

    expect(clientRequest).toHaveBeenCalledWith(
      'POST /v1/contacts/civic-panel/reach-lists',
      {
        group: { kind: 'group', group: 'age65plus' },
        channel: 'phone',
        name: 'Call: People 65 and over',
      },
    )
    expect(await screen.findByTestId('list-id')).toHaveTextContent('7')
    expect(screen.getByTestId('list-name')).toHaveTextContent(
      'Call: People 65 and over',
    )
    expect(screen.getByTestId('script')).toHaveTextContent(
      'I want to hear from people across Asheville',
    )
    expect(push).not.toHaveBeenCalled()
  })

  it('says so when nobody is left to reach that way', async () => {
    clientRequest.mockRejectedValue(
      Object.assign(new Error('422'), { status: 422 }),
    )
    renderNext()

    await userEvent.click(
      within(rowOf('Around Pine St')).getByRole('button', {
        name: 'Call, Around Pine St',
      }),
    )

    await waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith(
        'Nobody there is left to reach this way.',
      ),
    )
  })

  it('gives every row a 44px target on a phone and puts them inline from lg', () => {
    renderNext()
    const knock = within(rowOf('Around Pine St')).getByRole('button', {
      name: 'Knock doors, Around Pine St',
    })
    expect(knock).toHaveClass('min-h-11', 'lg:min-h-0')
    expect(rowOf('Around Pine St')).toHaveClass('flex-col', 'lg:flex-row')
  })

  it('offers no buttons while GoodParty is still inviting', () => {
    renderNext(false)
    expect(
      screen.queryByRole('button', { name: /Knock doors/ }),
    ).not.toBeInTheDocument()
  })
})
