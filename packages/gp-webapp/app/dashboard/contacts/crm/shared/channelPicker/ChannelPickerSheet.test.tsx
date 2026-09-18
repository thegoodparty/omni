import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RecommendedList } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useContactsTable } from '../../ContactsTableProvider'
import ChannelPickerSheet from './ChannelPickerSheet'

vi.mock('../../ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))

const DETAIL = {
  demographics: { people: 20081, avgAge: 53, avgIncome: 136384 },
  reachability: {
    sms: 16449,
    robocall: 3634,
    phoneBanking: 17406,
    doorKnocking: 20081,
    polls: 16449,
  },
  outreachHistory: [],
}

const RECOMMENDATION: RecommendedList = {
  variant: 'introNeverIded',
  intent: 'introduce',
  filter: { voterStatus: ['Super', 'Likely'], supportStatus: ['unknown'] },
  count: 20081,
  copy: {
    title: 'Meet voters who have not heard from you',
    criteriaSummary: 'Moderate to high propensity voters.',
  },
  existingFilterId: null,
}

const rowNamed = (name: RegExp) => screen.getByRole('link', { name })

beforeEach(() => {
  testQueryClient.clear()
  api.reset()
  vi.clearAllMocks()
  vi.mocked(useContactsTable).mockReturnValue({
    canUseProFeatures: true,
    isWinContext: true,
    isWinContextReady: true,
    voterDataUnavailable: false,
  } as unknown as ReturnType<typeof useContactsTable>)
})

describe('ChannelPickerSheet', () => {
  it('renders nothing when closed', () => {
    render(<ChannelPickerSheet target={null} onClose={vi.fn()} />)

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('lists every channel for a saved list with its reach, cost and destination', async () => {
    api.mock('GET /v1/contacts/list-detail', { status: 200, data: DETAIL })

    render(
      <ChannelPickerSheet
        target={{ kind: 'list', segment: { id: 42, name: 'GOTV text list' } }}
        onClose={vi.fn()}
      />,
    )

    expect(
      await screen.findByRole('heading', { name: 'Choose a channel' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText('GOTV text list · 20,081 voters'),
    ).toBeInTheDocument()

    const sms = rowNamed(/^SMS/)
    expect(sms).toHaveTextContent('16,449 reachable · $575.72')
    expect(sms).toHaveAttribute(
      'href',
      '/dashboard/outreach?compose=text&source=voter_data&listId=42',
    )
    expect(rowNamed(/^Robocall/)).toHaveTextContent('3,634 reachable · $163.53')
    expect(rowNamed(/^Phone banking/)).toHaveTextContent(
      '17,406 reachable · Free',
    )
    expect(rowNamed(/^Door knocking/)).toHaveTextContent(
      '20,081 reachable · Free',
    )
    expect(rowNamed(/^Door knocking/)).toHaveAttribute(
      'href',
      '/dashboard/door-knocking?create=1&listId=42',
    )
    expect(rowNamed(/^Social media/)).toHaveTextContent('Free')
    expect(rowNamed(/^Social media/)).toHaveAttribute(
      'href',
      '/dashboard/outreach?compose=social&source=voter_data',
    )
  })

  // The prototype orders rows by how many of the list each channel reaches;
  // social has no audience and sits last.
  // The global base style underlines every anchor on hover; a channel row
  // is a card, not inline text, so it opts out.
  it('renders the channel rows without the anchor hover underline', async () => {
    api.mock('GET /v1/contacts/list-detail', { status: 200, data: DETAIL })

    render(
      <ChannelPickerSheet
        target={{ kind: 'recommended', recommendation: RECOMMENDATION }}
        onClose={vi.fn()}
      />,
    )

    await screen.findByRole('heading', { name: 'Choose a channel' })
    for (const row of screen.getAllByRole('link')) {
      expect(row).toHaveClass('no-underline')
    }
  })

  it('orders the channels by reach, social last', async () => {
    api.mock('GET /v1/contacts/list-detail', { status: 200, data: DETAIL })

    render(
      <ChannelPickerSheet
        target={{ kind: 'list', segment: { id: 42, name: 'GOTV text list' } }}
        onClose={vi.fn()}
      />,
    )

    await screen.findByText('GOTV text list · 20,081 voters')
    const names = screen
      .getAllByRole('link')
      .map((row) => within(row).getByRole('heading').textContent)
    expect(names).toEqual([
      'Door knocking',
      'Phone banking',
      'SMS',
      'Robocall',
      'Social media',
    ])
  })

  it('uses the recommendation filter and count for an unsaved recommendation', async () => {
    const bodies: Record<string, unknown>[] = []
    api.mock('POST /v1/contacts/list-detail', ({ body }) => {
      bodies.push(body)
      return { status: 200, data: DETAIL }
    })

    render(
      <ChannelPickerSheet
        target={{ kind: 'recommended', recommendation: RECOMMENDATION }}
        onClose={vi.fn()}
      />,
    )

    expect(
      await screen.findByText(
        'Meet voters who have not heard from you · 20,081 voters',
      ),
    ).toBeInTheDocument()
    expect(
      await screen.findByText('16,449 reachable · $575.72'),
    ).toBeInTheDocument()
    expect(rowNamed(/^SMS/)).toHaveAttribute(
      'href',
      '/dashboard/outreach?compose=text&source=voter_data&recommended=introNeverIded',
    )
    expect(bodies[0]).toMatchObject({
      audienceSuperVoters: true,
      audienceLikelyVoters: true,
      supportStatus: ['unknown'],
    })
  })

  it('reads the whole district for the universe row', async () => {
    const queries: Record<string, unknown>[] = []
    api.mock('GET /v1/contacts/list-detail', ({ query }) => {
      queries.push(query)
      return { status: 200, data: DETAIL }
    })

    render(
      <ChannelPickerSheet target={{ kind: 'universe' }} onClose={vi.fn()} />,
    )

    expect(
      await screen.findByText('All voters · 20,081 voters'),
    ).toBeInTheDocument()
    expect(queries[0]).not.toHaveProperty('segment')
    expect(rowNamed(/^SMS/)).toHaveAttribute(
      'href',
      '/dashboard/outreach?compose=text&source=voter_data',
    )
  })

  it('shows a counting state and then Unavailable when the aggregates fail', async () => {
    api.mock('GET /v1/contacts/list-detail', {
      status: 502,
      data: { message: 'Voter data is temporarily unavailable.' },
    })

    render(
      <ChannelPickerSheet
        target={{ kind: 'list', segment: { id: 42, name: 'GOTV text list' } }}
        onClose={vi.fn()}
      />,
    )

    expect((await screen.findAllByText('Unavailable')).length).toBe(4)
    // The rows stay usable: a count that failed is not a channel that failed.
    expect(rowNamed(/^SMS/)).toHaveAttribute(
      'href',
      '/dashboard/outreach?compose=text&source=voter_data&listId=42',
    )
  })

  it('closes through the sheet', async () => {
    api.mock('GET /v1/contacts/list-detail', { status: 200, data: DETAIL })
    const onClose = vi.fn()

    render(
      <ChannelPickerSheet
        target={{ kind: 'list', segment: { id: 42, name: 'GOTV text list' } }}
        onClose={onClose}
      />,
    )

    await userEvent.click(await screen.findByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
