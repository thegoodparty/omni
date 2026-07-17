import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import ListDetailPage from './ListDetailPage'

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ isPro: true }],
}))
vi.mock('@shared/hooks/useElectedOffice', () => ({
  useElectedOffice: () => ({ data: null }),
}))
vi.mock('../../../shared/useWinVoterContext', () => ({
  useWinVoterContext: () => ({ isWin: true, isReady: true }),
}))
vi.mock('../../../shared/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  }),
}))

const emptyDetailResponse = {
  demographics: { people: 100, avgAge: 42, avgIncome: 65000 },
  reachability: {
    sms: 100,
    robocall: 100,
    phoneBanking: 100,
    doorKnocking: 100,
    email: null,
    metaAds: null,
  },
  outreachHistory: [],
}

beforeEach(() => {
  api.reset()
  api.mock('GET /v1/contacts/list-detail', {
    status: 200,
    data: emptyDetailResponse,
  })
})

describe('ListDetailPage — locked-state affordance (firstUsedForOutreachAt)', () => {
  it('shows a Rename affordance for an unlocked list', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 42, name: 'GOTV text list' }],
    })

    render(<ListDetailPage listId="42" />)

    expect(
      await screen.findByRole('button', { name: 'Rename list' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /duplicate to edit/i }),
    ).not.toBeInTheDocument()
  })

  it('shows "Duplicate to edit" instead of Rename once firstUsedForOutreachAt is set', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [
        {
          id: 42,
          name: 'GOTV text list',
          firstUsedForOutreachAt: '2026-07-01T00:00:00.000Z',
        },
      ],
    })

    render(<ListDetailPage listId="42" />)

    expect(
      await screen.findByRole('button', { name: /duplicate to edit/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Rename list' }),
    ).not.toBeInTheDocument()
  })
})

describe('ListDetailPage — not-found state', () => {
  it('renders a not-found message when no saved list matches the URL id', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [{ id: 99, name: 'Some other list' }],
    })

    render(<ListDetailPage listId="42" />)

    expect(await screen.findByText(/couldn.t be found/i)).toBeInTheDocument()
  })
})

describe('ListDetailPage — segments-fetch error state', () => {
  it('renders a retry-able error message, not the not-found copy, when the filters fetch fails', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 500,
      data: { message: 'server exploded' },
    })

    render(<ListDetailPage listId="42" />)

    expect(
      await screen.findByText(/couldn.t load this list/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/may have been deleted/i)).not.toBeInTheDocument()
  })
})
