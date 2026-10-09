import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { api } from 'helpers/test-utils/api-mocking'
import { render } from 'helpers/test-utils/render'
import ChatListProposal, {
  type ChatListProposalPayload,
} from './ChatListProposal'

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-test' }),
}))

const campaign = vi.hoisted(() => ({
  current: null as { id: number; isPro: boolean } | null,
}))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [campaign.current, vi.fn()],
}))

vi.mock('app/dashboard/shared/membership/ProPitchDialog', () => ({
  ProPitchDialog: ({
    open,
    source,
    channel,
  }: {
    open: boolean
    source: string
    channel: string
  }) =>
    open ? <div data-testid="pro-pitch">{`${source}:${channel}`}</div> : null,
}))

const errorSnackbar = vi.fn()
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    successSnackbar: vi.fn(),
    errorSnackbar,
    displaySnackbar: vi.fn(),
  }),
}))

// The map card fetches its list's people and row, which this card does not
// own. The stub only says which list it was handed.
vi.mock('./ChatListMap', () => ({
  __esModule: true,
  default: ({ listId, name }: { listId: number; name: string }) => (
    <div data-testid="list-map">{`${name} (${listId})`}</div>
  ),
}))

const proposal = (key: string): ChatListProposalPayload => ({
  name: 'North Asheville homeowners',
  summary: 'Homeowners with a cell phone on file.',
  count: 24361,
  filters: { homeownerYes: true, hasCellPhone: true },
  proposalKey: key,
})

describe('ChatListProposal', () => {
  it('offers the list with a Create list button until it exists', async () => {
    api.mock('GET /v1/voters/voter-file/filter/by-proposal-key/:proposalKey', {
      status: 404,
      data: {},
    })
    render(
      <ChatListProposal
        proposal={proposal('8b7d2f4e-5c1a-4b9e-9f2d-1a2b3c4d5e61')}
        onCreated={vi.fn()}
      />,
    )

    expect(
      await screen.findByRole('button', { name: 'Create list' }),
    ).toBeInTheDocument()
    expect(screen.getByText('North Asheville homeowners')).toBeInTheDocument()
    expect(screen.getByText('24,361 constituents')).toBeInTheDocument()
  })

  // The press is the confirmation a typed "yes" used to be, and the card
  // becomes the list so there is no separate map step to ask for.
  it('saves the counted filter under its key and becomes the map', async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn()
    const key = '8b7d2f4e-5c1a-4b9e-9f2d-1a2b3c4d5e62'
    let sent: Record<string, unknown> | null = null
    api.mock('GET /v1/voters/voter-file/filter/by-proposal-key/:proposalKey', {
      status: 404,
      data: {},
    })
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      sent = body as Record<string, unknown>
      return {
        status: 200,
        data: { id: 52, name: 'North Asheville homeowners' },
      } as never
    })
    render(<ChatListProposal proposal={proposal(key)} onCreated={onCreated} />)

    await user.click(await screen.findByRole('button', { name: 'Create list' }))

    expect(await screen.findByTestId('list-map')).toHaveTextContent(
      'North Asheville homeowners (52)',
    )
    expect(sent).toEqual({
      homeownerYes: true,
      hasCellPhone: true,
      name: 'North Asheville homeowners',
      proposalKey: key,
    })
    expect(onCreated).toHaveBeenCalledWith({
      listId: 52,
      name: 'North Asheville homeowners',
    })
  })

  // A reloaded transcript must never offer to make a list it already made.
  it('shows the list it already made instead of the button', async () => {
    api.mock('GET /v1/voters/voter-file/filter/by-proposal-key/:proposalKey', {
      status: 200,
      data: { id: 52, name: 'North Asheville homeowners' },
    })
    render(
      <ChatListProposal
        proposal={proposal('8b7d2f4e-5c1a-4b9e-9f2d-1a2b3c4d5e63')}
        onCreated={vi.fn()}
      />,
    )

    expect(await screen.findByTestId('list-map')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Create list' }),
    ).not.toBeInTheDocument()
  })

  it('keeps the button live when the save fails', async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn()
    api.mock('GET /v1/voters/voter-file/filter/by-proposal-key/:proposalKey', {
      status: 404,
      data: {},
    })
    api.mock('POST /v1/voters/voter-file/filter', { status: 500, data: {} })
    render(
      <ChatListProposal
        proposal={proposal('8b7d2f4e-5c1a-4b9e-9f2d-1a2b3c4d5e64')}
        onCreated={onCreated}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'Create list' }))

    await vi.waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith('Failed to create list'),
    )
    expect(onCreated).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'Create list' }),
    ).toBeInTheDocument()
  })

  describe('in Campaign Manager', () => {
    it('counts voters', async () => {
      campaign.current = { id: 9, isPro: true }
      api.mock(
        'GET /v1/voters/voter-file/filter/by-proposal-key/:proposalKey',
        { status: 404, data: {} },
      )
      render(
        <ChatListProposal
          proposal={proposal('8b7d2f4e-5c1a-4b9e-9f2d-1a2b3c4d5e65')}
          mode="win"
          onCreated={vi.fn()}
        />,
      )

      expect(await screen.findByText('24,361 voters')).toBeInTheDocument()
      expect(screen.queryByText(/constituent/)).not.toBeInTheDocument()
    })

    it('takes a free campaign to the Pro pitch instead of saving', async () => {
      const user = userEvent.setup()
      campaign.current = { id: 9, isPro: false }
      let posted = false
      api.mock(
        'GET /v1/voters/voter-file/filter/by-proposal-key/:proposalKey',
        { status: 404, data: {} },
      )
      api.mock('POST /v1/voters/voter-file/filter', () => {
        posted = true
        return { status: 200, data: { id: 52 } } as never
      })
      render(
        <ChatListProposal
          proposal={proposal('8b7d2f4e-5c1a-4b9e-9f2d-1a2b3c4d5e66')}
          mode="win"
          onCreated={vi.fn()}
        />,
      )

      await user.click(
        await screen.findByRole('button', { name: 'Create list' }),
      )

      expect(await screen.findByTestId('pro-pitch')).toHaveTextContent(
        'campaign_manager:voter-data',
      )
      expect(posted).toBe(false)
    })

    it('holds the button until the campaign has loaded', async () => {
      campaign.current = null
      api.mock(
        'GET /v1/voters/voter-file/filter/by-proposal-key/:proposalKey',
        { status: 404, data: {} },
      )
      render(
        <ChatListProposal
          proposal={proposal('8b7d2f4e-5c1a-4b9e-9f2d-1a2b3c4d5e68')}
          mode="win"
          onCreated={vi.fn()}
        />,
      )

      expect(await screen.findByText('24,361 voters')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Create list' }),
      ).not.toBeInTheDocument()
    })

    it('links a saved list to Voter Data instead of the map', async () => {
      campaign.current = { id: 9, isPro: true }
      api.mock(
        'GET /v1/voters/voter-file/filter/by-proposal-key/:proposalKey',
        { status: 200, data: { id: 52, name: 'North Asheville homeowners' } },
      )
      render(
        <ChatListProposal
          proposal={proposal('8b7d2f4e-5c1a-4b9e-9f2d-1a2b3c4d5e67')}
          mode="win"
          onCreated={vi.fn()}
        />,
      )

      const link = await screen.findByRole('link', {
        name: /North Asheville homeowners/,
      })
      expect(link).toHaveAttribute('href', '/dashboard/contacts/lists/52')
      expect(link).toHaveTextContent('Created · 24,361 voters')
      expect(screen.queryByTestId('list-map')).not.toBeInTheDocument()
    })
  })
})
