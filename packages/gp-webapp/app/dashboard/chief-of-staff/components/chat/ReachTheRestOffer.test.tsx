import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CivicPanelReachOptions } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { ReachTheRestOffer } from './ReachTheRestOffer'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn() }),
}))
vi.mock('@shared/organization-picker', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOrganization: () => ({ slug: 'eo-test' }),
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

const OPTIONS: CivicPanelReachOptions = {
  place: 'Asheville',
  mostlyNoCell: true,
  options: [
    {
      label: 'Knock doors in West Asheville',
      detail: '4 seats short. 120 homes there have no cell phone on file.',
      group: { kind: 'tract', key: '37021000100' },
      channel: 'door',
      seatsShort: 4,
      homes: 120,
    },
    {
      label: 'Call people 65 and over',
      detail: '3 seats short. 45 of their homes have a landline.',
      group: { kind: 'group', group: 'age65plus' },
      channel: 'phone',
      seatsShort: 3,
      homes: 45,
    },
  ],
}

const clientRequest = vi.fn()
vi.mock('gpApi/typed-request', () => ({
  clientRequest: (route: string, payload: object) =>
    clientRequest(route, payload),
}))

describe('ReachTheRestOffer', () => {
  beforeEach(() => {
    push.mockClear()
    clientRequest.mockReset()
    clientRequest.mockImplementation(async (route: string) =>
      route === 'GET /v1/contacts/civic-panel/reach-options'
        ? { data: OPTIONS }
        : { data: { listId: 42, people: 120 } },
    )
  })

  it('shows each short group with its line, plain, and a way to write your own', async () => {
    render(<ReachTheRestOffer disabled={false} onAnswer={vi.fn()} />)

    expect(
      await screen.findByText('Knock doors in West Asheville'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '4 seats short. 120 homes there have no cell phone on file.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Call people 65 and over')).toBeInTheDocument()
    expect(screen.queryByText(/Why this option/)).not.toBeInTheDocument()
    expect(screen.getByText(/write your own/i)).toBeInTheDocument()
  })

  it('answers and opens door knocking on a list of the group', async () => {
    const onAnswer = vi.fn()
    render(<ReachTheRestOffer disabled={false} onAnswer={onAnswer} />)

    await userEvent.click(
      await screen.findByText('Knock doors in West Asheville'),
    )

    expect(onAnswer).toHaveBeenCalledWith('Knock doors in West Asheville')
    expect(clientRequest).toHaveBeenCalledWith(
      'POST /v1/contacts/civic-panel/reach-lists',
      {
        group: { kind: 'tract', key: '37021000100' },
        channel: 'door',
        name: 'Knock doors in West Asheville',
      },
    )
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        '/dashboard/door-knocking?create=1&listId=42&purpose=build_citizens_panel',
      ),
    )
  })

  it('opens phone banking for a call option', async () => {
    render(<ReachTheRestOffer disabled={false} onAnswer={vi.fn()} />)

    await userEvent.click(await screen.findByText('Call people 65 and over'))

    expect(await screen.findByTestId('list-id')).toHaveTextContent('42')
    expect(screen.getByTestId('script')).toHaveTextContent(
      'Would you like to be one of them?',
    )
  })

  it('shows nothing when no group is left to offer', async () => {
    clientRequest.mockResolvedValue({
      data: { place: null, mostlyNoCell: false, options: [] },
    })
    render(<ReachTheRestOffer disabled={false} onAnswer={vi.fn()} />)

    await waitFor(() =>
      expect(screen.queryByTestId('reach-the-rest-offer')).toBeNull(),
    )
    expect(screen.queryByText(/Knock doors/)).toBeNull()
  })
})
