import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListDetailContactsResponse } from '@goodparty_org/contracts'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useServeCitizenPanelsFlag } from '@shared/experiments/serveCitizenPanelsFlag'
import { useContactsTable } from '../ContactsTableProvider'
import { useContactsDownload } from '../shared/useContactsDownload'
import { makePerson } from '../shared/test-fixtures'
import { CitizensPanelListCard } from './CitizensPanelListCard'
import ListDetailSheet from './ListDetailSheet'

type OutreachHistory = ListDetailContactsResponse['outreachHistory']

vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-test-org' }),
}))
vi.mock('../ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
vi.mock('@shared/experiments/serveCitizenPanelsFlag', () => ({
  useServeCitizenPanelsFlag: vi.fn(),
}))
vi.mock('../shared/useContactsDownload', () => ({
  useContactsDownload: vi.fn(),
}))
vi.mock('../shared/channelPicker/ChannelPickerProvider', () => ({
  useOpenChannelPicker: () => vi.fn(),
}))
// deck.gl and maplibre don't run in jsdom; the stub reports how many people
// it was handed.
vi.mock('../map/ContactListMap', () => ({
  __esModule: true,
  default: ({ people }: { people: unknown[] }) => (
    <div data-testid="contact-map-stub" data-people={people.length} />
  ),
}))

const selectList = vi.fn()
const selectPerson = vi.fn()

const setContext = ({
  isWinContext = false,
  flagOn = true,
}: { isWinContext?: boolean; flagOn?: boolean } = {}) => {
  vi.mocked(useContactsTable).mockReturnValue({
    canUseProFeatures: true,
    isElectedOfficial: !isWinContext,
    isWinContext,
    isWinContextReady: true,
    voterDataUnavailable: false,
    selectList,
    selectPerson,
    editList: vi.fn(),
  } as unknown as ReturnType<typeof useContactsTable>)
  vi.mocked(useServeCitizenPanelsFlag).mockReturnValue({
    ready: true,
    enabled: flagOn,
  })
}

const mockSummary = (members: number, lastOutreachAt: string | null = null) =>
  api.mock('GET /v1/contacts/civic-panel', {
    status: 200,
    data: {
      members,
      reachedRecently: 0,
      askableNow: members,
      lastOutreachAt: lastOutreachAt as unknown as Date | null,
    },
  })

beforeEach(() => {
  testQueryClient.clear()
  api.reset()
  vi.clearAllMocks()
  setContext()
  vi.mocked(useContactsDownload).mockReturnValue({
    download: vi.fn(),
    downloadFromHref: vi.fn(),
    isPreparing: false,
  })
})

describe('CitizensPanelListCard', () => {
  it('shows the live member count and opens the built-in list', async () => {
    mockSummary(2)
    render(<CitizensPanelListCard />)

    expect(await screen.findByText('Civic panel')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('No outreach yet')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(selectList).toHaveBeenCalledWith('civicPanel')
  })

  it('shows when the panel was last reached, without the list detail', async () => {
    const detail = vi.fn()
    api.mock('GET /v1/contacts/list-detail', () => {
      detail()
      return { status: 500, data: {} }
    })
    mockSummary(2, '2026-10-13T12:00:00.000Z')
    render(<CitizensPanelListCard />)

    expect(
      await screen.findByText('Last outreach Oct 13, 2026'),
    ).toBeInTheDocument()
    expect(screen.queryByText('No outreach yet')).not.toBeInTheDocument()
    expect(detail).not.toHaveBeenCalled()
  })

  it('stays hidden until someone has joined', async () => {
    const summary = vi.fn()
    api.mock('GET /v1/contacts/civic-panel', () => {
      summary()
      return {
        status: 200,
        data: {
          members: 0,
          reachedRecently: 0,
          askableNow: 0,
          lastOutreachAt: null,
        },
      }
    })
    render(<CitizensPanelListCard />)

    await waitFor(() => expect(summary).toHaveBeenCalled())
    expect(screen.queryByText('Civic panel')).not.toBeInTheDocument()
  })

  it('stays hidden with the flag off, without asking for the panel', () => {
    setContext({ flagOn: false })
    const summary = vi.fn()
    api.mock('GET /v1/contacts/civic-panel', () => {
      summary()
      return {
        status: 200,
        data: {
          members: 2,
          reachedRecently: 0,
          askableNow: 2,
          lastOutreachAt: null,
        },
      }
    })
    render(<CitizensPanelListCard />)

    expect(screen.queryByText('Civic panel')).not.toBeInTheDocument()
    expect(summary).not.toHaveBeenCalled()
  })

  it('never shows on Win', () => {
    setContext({ isWinContext: true })
    mockSummary(2)
    render(<CitizensPanelListCard />)

    expect(screen.queryByText('Civic panel')).not.toBeInTheDocument()
  })
})

describe('ListDetailSheet — the built-in civic panel list', () => {
  const mockPanel = (outreachHistory: OutreachHistory = []) => {
    const detailSegments: unknown[] = []
    const segments: (string | undefined)[] = []
    api.mock('GET /v1/contacts/list-detail', ({ query }) => {
      detailSegments.push(query.segment)
      return {
        status: 200,
        data: {
          demographics: { people: 2, avgAge: 54, avgIncome: 95592 },
          reachability: {
            sms: 2,
            robocall: 0,
            phoneBanking: 2,
            doorKnocking: 2,
            polls: 2,
          },
          outreachHistory,
        },
      }
    })
    api.mock('GET /v1/contacts', ({ query }) => {
      segments.push(query.segment)
      return {
        status: 200,
        data: {
          pagination: {
            totalResults: 2,
            currentPage: 1,
            pageSize: 10000,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false,
          },
          people: [
            makePerson({ id: 'p-1', firstName: 'Ada', lastName: 'Lovelace' }),
            makePerson({ id: 'p-2', firstName: 'Grace', lastName: 'Hopper' }),
          ],
        },
      }
    })
    return { detailSegments, segments }
  }

  it('renders the same sections a saved list does, read live with no saved list', async () => {
    api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
    const { detailSegments, segments } = mockPanel()
    render(<ListDetailSheet listId="civicPanel" onClose={vi.fn()} />)

    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByRole('heading', { name: 'Civic panel' }),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole('heading', { name: 'Constituent list details' }),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('List filters')).toBeInTheDocument()
    expect(within(dialog).getByText('On your civic panel.')).toBeInTheDocument()
    expect(
      within(dialog).queryByRole('link', { name: /who can be asked now/ }),
    ).not.toBeInTheDocument()
    expect(within(dialog).getByText('Where they are')).toBeInTheDocument()
    expect(
      await within(dialog).findByTestId('contact-map-stub'),
    ).toHaveAttribute('data-people', '2')
    expect(within(dialog).getByText('List demographics')).toBeInTheDocument()
    expect(await within(dialog).findByText('$95,592')).toBeInTheDocument()
    expect(within(dialog).getByText('Last outreach')).toBeInTheDocument()
    expect(within(dialog).getByText('Last method')).toBeInTheDocument()
    expect(within(dialog).getByText('Reachable by channel')).toBeInTheDocument()
    expect(
      within(dialog).getByRole('heading', {
        name: 'Outreach campaign history',
      }),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('No outreach yet.')).toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', { name: 'Download list' }),
    ).toBeInTheDocument()

    expect(segments).toEqual(['civicPanel'])
    expect(detailSegments).toEqual(['civicPanel'])
    expect(
      within(dialog).queryByText(/couldn.t be found/),
    ).not.toBeInTheDocument()
  })

  it('shows the sends that reached the panel as its history', async () => {
    api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
    mockPanel([
      {
        id: 7,
        name: 'Ask about the park',
        outreachType: 'nativePhoneBanking',
        status: 'completed',
        date: '2026-10-13T12:00:00.000Z',
        createdAt: '2026-10-12T12:00:00.000Z',
      },
      {
        id: 3,
        name: 'Join my civic panel',
        outreachType: 'text',
        status: 'completed',
        date: '2026-09-01T12:00:00.000Z',
        createdAt: '2026-08-30T12:00:00.000Z',
      },
    ] as unknown as OutreachHistory)
    render(<ListDetailSheet listId="civicPanel" onClose={vi.fn()} />)

    const dialog = await screen.findByRole('dialog')
    expect(
      await within(dialog).findByText('Ask about the park'),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Join my civic panel')).toBeInTheDocument()
    expect(
      within(dialog).queryByText('No outreach yet.'),
    ).not.toBeInTheDocument()
    // Once as Last outreach, once in the history row.
    expect(within(dialog).getAllByText('Oct 13, 2026')).toHaveLength(2)
    expect(
      within(dialog).getByText('Last method').parentElement,
    ).toHaveTextContent('Phone banking')
  })

  it('lists no member names and offers no shape drawing or list actions', async () => {
    api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
    mockPanel()
    render(<ListDetailSheet listId="civicPanel" onClose={vi.fn()} />)

    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByTestId('contact-map-stub')
    expect(within(dialog).queryByText('Members')).not.toBeInTheDocument()
    expect(
      within(dialog).queryByText(/Lovelace|Hopper/),
    ).not.toBeInTheDocument()
    expect(
      within(dialog).queryByRole('button', { name: /shapes/ }),
    ).not.toBeInTheDocument()
    expect(
      within(dialog).queryByRole('button', { name: 'More actions' }),
    ).not.toBeInTheDocument()
    expect(
      within(dialog).queryByRole('button', { name: 'Edit list' }),
    ).not.toBeInTheDocument()
  })

  it('is an unknown list with the flag off', async () => {
    setContext({ flagOn: false })
    api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
    const { detailSegments, segments } = mockPanel()
    render(<ListDetailSheet listId="civicPanel" onClose={vi.fn()} />)

    expect(
      await screen.findByText(
        "This list couldn't be found. It may have been deleted.",
      ),
    ).toBeInTheDocument()
    expect(detailSegments).toEqual([])
    expect(segments).toEqual([])
  })
})
