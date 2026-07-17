import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
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
  useSnackbar: vi.fn(),
}))

// Stable mock references (not a fresh vi.fn() per useSnackbar() call) — both
// useContactsDownload and useDuplicateList call useSnackbar() independently
// from inside ListDetailPage, so the test needs one shared instance to
// assert against regardless of which internal hook fired it.
const mockedUseSnackbar = vi.mocked(useSnackbar)
const successSnackbar = vi.fn()
const errorSnackbar = vi.fn()

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
  vi.clearAllMocks()
  mockedUseSnackbar.mockReturnValue({
    successSnackbar,
    errorSnackbar,
    displaySnackbar: vi.fn(),
  })
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

describe('ListDetailPage — "Duplicate to edit" (the sole edit path for a locked list)', () => {
  const lockedSegment = {
    id: 42,
    name: 'GOTV text list',
    firstUsedForOutreachAt: '2026-07-01T00:00:00.000Z',
  }

  it('posts a copy and navigates to the new list on success', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [lockedSegment],
    })
    let sentBody: Record<string, unknown> | null = null
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      sentBody = body as Record<string, unknown>
      return {
        status: 200,
        data: { id: 555, name: 'GOTV text list (copy)' },
      }
    })
    const user = userEvent.setup()

    render(<ListDetailPage listId="42" />)

    await user.click(
      await screen.findByRole('button', { name: /duplicate to edit/i }),
    )

    await vi.waitFor(() =>
      expect(router.push).toHaveBeenCalledWith('/dashboard/contacts/lists/555'),
    )
    expect(sentBody).toMatchObject({ name: 'GOTV text list (copy)' })
    expect(successSnackbar).toHaveBeenCalledWith('List duplicated')
    expect(errorSnackbar).not.toHaveBeenCalled()
  })

  it('shows an error snackbar and does not navigate when the duplicate call fails', async () => {
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [lockedSegment],
    })
    api.mock('POST /v1/voters/voter-file/filter', {
      status: 500,
      data: { message: 'server exploded' },
    })
    const user = userEvent.setup()

    render(<ListDetailPage listId="42" />)

    await user.click(
      await screen.findByRole('button', { name: /duplicate to edit/i }),
    )

    await vi.waitFor(() =>
      expect(errorSnackbar).toHaveBeenCalledWith('Failed to duplicate list'),
    )
    expect(router.push).not.toHaveBeenCalled()
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
