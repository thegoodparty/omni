import { beforeEach, describe, expect, it, vi } from 'vitest'
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

const mockSummary = (members: number) =>
  api.mock('GET /v1/contacts/civic-panel', {
    status: 200,
    data: { members, reachedRecently: 0, askableNow: members },
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

  it('stays hidden until someone has joined', async () => {
    const summary = vi.fn()
    api.mock('GET /v1/contacts/civic-panel', () => {
      summary()
      return {
        status: 200,
        data: { members: 0, reachedRecently: 0, askableNow: 0 },
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
        data: { members: 2, reachedRecently: 0, askableNow: 2 },
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
  const mockPanel = () => {
    const detailBodies: unknown[] = []
    const segments: (string | undefined)[] = []
    api.mock('POST /v1/contacts/list-detail', ({ body }) => {
      detailBodies.push(body)
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
          outreachHistory: [],
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
    return { detailBodies, segments }
  }

  it('renders the same sections a saved list does, read live with no saved list', async () => {
    api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
    const { detailBodies, segments } = mockPanel()
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
      within(dialog).getByRole('link', {
        name: 'Make a list of who can be asked now',
      }),
    ).toBeInTheDocument()
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
    expect(detailBodies).toEqual([{ civicPanelMember: true }])
    expect(
      within(dialog).queryByText(/couldn.t be found/),
    ).not.toBeInTheDocument()
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
    const { detailBodies, segments } = mockPanel()
    render(<ListDetailSheet listId="civicPanel" onClose={vi.fn()} />)

    expect(
      await screen.findByText(
        "This list couldn't be found. It may have been deleted.",
      ),
    ).toBeInTheDocument()
    expect(detailBodies).toEqual([])
    expect(segments).toEqual([])
  })
})
