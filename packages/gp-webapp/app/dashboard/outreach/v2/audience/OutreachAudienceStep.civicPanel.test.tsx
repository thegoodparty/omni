import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CivicPanelSummary } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useServeCitizenPanelsFlag } from '@shared/experiments/serveCitizenPanelsFlag'
import type { SegmentResponse } from 'app/dashboard/contacts/crm/shared/contacts-types'
import {
  OutreachAudienceStep,
  type OutreachAudienceCopy,
} from './OutreachAudienceStep'
import { useCivicPanelAudience } from './useCivicPanelAudience'
import { isCivicPanelAudienceList } from './civicPanelAudienceList.util'

const mockOrg = vi.hoisted(() => ({ slug: 'eo-test-org' }))
vi.mock('@shared/experiments/serveCitizenPanelsFlag', () => ({
  useServeCitizenPanelsFlag: vi.fn(),
}))

const COPY: OutreachAudienceCopy = {
  pickerTitle: 'Who do you want to reach?',
  pickerBody: 'Pick a saved constituent list.',
  filtersTitle: 'Build a list',
  filtersBody: 'Pick filters.',
  nameTitle: 'Name your list',
  nameBody: 'You can rename it any time.',
  reachVerb: 'Message',
  reachNoun: 'constituents',
  unitCostLabel: 'Each message costs',
}

const summary = (members: number): CivicPanelSummary => ({
  members,
  joinedBy: { text: 0, door: 0, phone: 0, hand: 0 },
  reachedRecently: 0,
  askableNow: members,
  lastOutreachAt: null,
  progress: {
    members,
    goal: 240,
    answersNeeded: 96,
    expectedAnswers: 0,
    groupsCovered: 0,
    groupsTotal: 0,
  },
  balance: null,
  composition: null,
})

const props = (overrides: Record<string, unknown> = {}) => ({
  channel: 'text' as const,
  copy: COPY,
  mode: 'picker' as const,
  lists: [] as SegmentResponse[],
  listsLoading: false,
  selectedId: null as number | null,
  onSelect: vi.fn(),
  onStartBuilder: vi.fn(),
  universeName: 'All constituents' as string | null,
  universeListId: null,
  universeCount: 12_000,
  universeLoading: false,
  onSelectUniverse: vi.fn(async () => 99),
  universePending: false,
  universeError: false,
  onPickerOpenChange: vi.fn(),
  recommendations: [],
  recommendationsLoading: false,
  recommendationsError: false,
  recommendedListsChannel: 'sms' as const,
  onCreateRecommendedList: vi.fn(async () => undefined),
  onRecommendationReused: vi.fn(),
  selectedRecommendation: null,
  onSelectRecommendation: vi.fn(),
  reachableCount: null,
  reachableLoading: false,
  pricePerContact: 0.035,
  builderFilters: {},
  onBuilderFiltersChange: vi.fn(),
  builderSupportStatus: [],
  builderPrecincts: [],
  onBuilderPrecinctsChange: vi.fn(),
  precinctOptions: {
    options: [],
    truncated: false,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  onBuilderSupportStatusChange: vi.fn(),
  builderName: '',
  onBuilderNameChange: vi.fn(),
  isElectedOfficial: true,
  builderCount: undefined,
  builderCounting: false,
  builderCapError: false,
  builderCountErrorMessage: undefined,
  ...overrides,
})

const PANEL_LIST: SegmentResponse = {
  id: 42,
  name: 'Your civic panel',
  civicPanelMember: true,
}

type StepProps = ReturnType<typeof props>

// The hook as useOutreachAudience mounts it, handed to the step the way
// every flow passes `audience.civicPanel`.
const Step = (p: StepProps) => {
  const civicPanel = useCivicPanelAudience({
    isElectedOfficial: p.isElectedOfficial as boolean,
    orgSlug: mockOrg.slug,
    lists: p.lists,
    listsQueryKey: ['outreach-audience-lists', mockOrg.slug],
  })
  return <OutreachAudienceStep {...p} civicPanel={civicPanel} />
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

beforeEach(() => {
  testQueryClient.clear()
  api.reset()
  vi.clearAllMocks()
  mockOrg.slug = 'eo-test-org'
  vi.mocked(useServeCitizenPanelsFlag).mockReturnValue({
    ready: true,
    enabled: true,
  })
  api.mock('GET /v1/contacts/civic-panel', {
    status: 200,
    data: summary(1240),
  })
})

describe('OutreachAudienceStep — the civic panel', () => {
  it('offers the civic panel first, with its member count', async () => {
    render(<Step {...props()} />)

    const card = await screen.findByTestId('civic-panel-audience-card')
    expect(card).toHaveTextContent('Your civic panel')
    expect(card).toHaveTextContent('1,240 people')
    expect(screen.getByText('Recommended for you')).toBeVisible()
  })

  it('saves the members-only list on first pick and selects it', async () => {
    const created: unknown[] = []
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      created.push(body)
      return { status: 200, data: { ...PANEL_LIST, id: 77 } }
    })
    const p = props()
    render(<Step {...p} />)

    await userEvent.click(
      await screen.findByTestId('civic-panel-audience-card'),
    )

    await waitFor(() => expect(p.onSelect).toHaveBeenCalledWith(77))
    expect(created).toEqual([
      { name: 'Your civic panel', civicPanelMember: true },
    ])
  })

  it('reuses the saved list and keeps it out of All lists', async () => {
    const p = props({
      lists: [PANEL_LIST, { id: 5, name: 'Main Street' }],
      selectedId: 42,
      reachableCount: 300,
    })
    render(<Step {...p} />)

    const card = await screen.findByTestId('civic-panel-audience-card')
    expect(card).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(card)
    expect(p.onSelect).toHaveBeenCalledWith(42)

    await userEvent.click(
      screen.getByRole('button', { name: /Your civic panel[\s\S]*Message/ }),
    )
    expect(await screen.findByText('Main Street')).toBeVisible()
    expect(screen.getAllByText('Your civic panel')).toHaveLength(2)
  })

  it('is hidden with no members', async () => {
    api.mock('GET /v1/contacts/civic-panel', {
      status: 200,
      data: summary(0),
    })
    render(<Step {...props()} />)

    await settle()
    expect(
      screen.queryByTestId('civic-panel-audience-card'),
    ).not.toBeInTheDocument()
  })

  it('is hidden with the flag off', async () => {
    vi.mocked(useServeCitizenPanelsFlag).mockReturnValue({
      ready: true,
      enabled: false,
    })
    render(<Step {...props()} />)

    await settle()
    expect(
      screen.queryByTestId('civic-panel-audience-card'),
    ).not.toBeInTheDocument()
  })

  it('is hidden on Win', async () => {
    mockOrg.slug = 'campaign-org'
    render(<Step {...props({ isElectedOfficial: false })} />)

    await settle()
    expect(
      screen.queryByTestId('civic-panel-audience-card'),
    ).not.toBeInTheDocument()
  })
})

describe('isCivicPanelAudienceList', () => {
  it('matches only our name with civicPanelMember alone', () => {
    expect(isCivicPanelAudienceList(PANEL_LIST)).toBe(true)
    expect(isCivicPanelAudienceList({ ...PANEL_LIST, name: 'My panel' })).toBe(
      false,
    )
    expect(
      isCivicPanelAudienceList({ ...PANEL_LIST, hasCellPhone: true }),
    ).toBe(false)
    expect(
      isCivicPanelAudienceList({ ...PANEL_LIST, civicPanelLeft: true }),
    ).toBe(false)
    expect(
      isCivicPanelAudienceList({
        ...PANEL_LIST,
        civicPanelJoinedFrom: '2026-01-01',
      }),
    ).toBe(false)
    expect(
      isCivicPanelAudienceList({ ...PANEL_LIST, civicPanelMember: false }),
    ).toBe(false)
  })
})
