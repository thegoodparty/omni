import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { api, mswServer } from 'helpers/test-utils/api-mocking'
import type { Campaign } from 'helpers/types'
import { EVENTS } from 'helpers/analyticsHelper'
import OnboardingFlow from './OnboardingFlow'
import type { OfficePickerGiveUpContext } from './onboardingTypes'

/*
    DATA-2525. Candidates who can't find their office in the picker drop into a
    manual form. That used to leave no usable trace: the manual step had no
    `Viewed` event, and its completion fired `Office Completed` under the same
    name as a normal pick, with the string 'manual' jammed into `officeLevel`.
    These tests pin the three things that fixed: the manual step's own `Viewed`
    event, the picker state it carries, and `officePath` as the discriminator.
*/

vi.mock('@shared/organization-picker', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/organization-picker')>()),
  useOrganization: () => ({
    slug: 'campaign-1',
    positionName: 'Mayor',
    district: { id: 'd1', l2Type: 'City', l2Name: 'Austin' },
  }),
}))

const { mockGetUserWebsite, mockSaveAboutFields, mockTrackEvent } = vi.hoisted(
  () => ({
    mockGetUserWebsite: vi.fn(),
    mockSaveAboutFields: vi.fn(),
    mockTrackEvent: vi.fn(),
  }),
)

vi.mock('app/dashboard/website/util/website.util', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('app/dashboard/website/util/website.util')
    >()
  return {
    ...actual,
    getUserWebsite: mockGetUserWebsite,
    saveAboutFields: mockSaveAboutFields,
  }
})

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: mockTrackEvent }
})

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn(), successSnackbar: vi.fn() }),
}))

// The per-step `Viewed` events attach the user's email directly and so are
// gated on a resolved user. Without this stub they never fire and every
// assertion below passes vacuously.
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ id: 7, email: 'candidate@example.com' }],
}))
vi.mock('@shared/utils/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/utils/analytics')>()),
  identifyUser: vi.fn().mockResolvedValue(undefined),
}))

// What the real picker hands over when the candidate gives up on it. Passing a
// context object matters: wiring onCantFindOffice straight to onClick would
// hand the flow a React synthetic event instead.
const GIVE_UP_CONTEXT: OfficePickerGiveUpContext = {
  officeZip: '78701',
  searchQuery: 'school board',
  categoryFilter: 'Local',
  totalOffices: 12,
  filteredCount: 0,
  searchErrored: false,
}

vi.mock('./OfficeSelectionStep', () => ({
  OfficeSelectionStep: ({
    onCantFindOffice,
  }: {
    onCantFindOffice: (context: OfficePickerGiveUpContext) => void
  }) => (
    <button type="button" onClick={() => onCantFindOffice(GIVE_UP_CONTEXT)}>
      mock cant find office
    </button>
  ),
}))

vi.mock('./ManualOfficeEntryStep', () => ({
  ManualOfficeEntryStep: ({
    onChange,
  }: {
    onChange: (form: {
      office: string
      level: string
      state: string
      city: string
      district: string
      officeTermLength: string
      electionDate: string
    }) => void
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange({
          office: 'Mayor',
          level: 'LOCAL',
          state: 'CA',
          city: 'Springfield',
          district: '',
          officeTermLength: '4 years',
          electionDate: '2099-01-01',
        })
      }
    >
      mock fill manual office
    </button>
  ),
}))

const renderFlow = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OnboardingFlow campaign={{ id: 1 } as Campaign} />
    </QueryClientProvider>,
  )

// Welcome through the manual form, giving up on the picker on the way.
const giveUpOnPickerAndFillManually = async (): Promise<void> => {
  const continueButton = screen.getByRole('button', { name: /continue/i })
  fireEvent.click(continueButton) // welcome -> ballot-status
  fireEvent.click(await screen.findByLabelText(/officially on the ballot/i))
  fireEvent.click(continueButton) // ballot-status -> party-affiliation
  fireEvent.click(await screen.findByLabelText(/nonpartisan race/i))
  fireEvent.click(continueButton) // party-affiliation -> office-selection
  fireEvent.click(
    await screen.findByRole('button', { name: /mock cant find office/i }),
  ) // office-selection -> manual-office-entry
  fireEvent.click(
    await screen.findByRole('button', { name: /mock fill manual office/i }),
  )
  fireEvent.click(continueButton) // manual-office-entry -> next step
}

const eventProps = (name: string): Record<string, unknown> | undefined =>
  mockTrackEvent.mock.calls.find(([event]) => event === name)?.[1]

beforeEach(() => {
  mockTrackEvent.mockClear()
  mockGetUserWebsite.mockReset().mockResolvedValue({ content: { about: {} } })
  mockSaveAboutFields.mockReset().mockResolvedValue(true)
  mswServer.use(
    http.put('/api/v1/campaigns/mine', () => HttpResponse.json({ id: 1 })),
    http.patch('/api/v1/organizations/:slug', () => HttpResponse.json({})),
  )
  api.mock('GET /v1/campaigns/mine/story', {
    status: 200,
    data: { background: '' },
  })
})

describe('manual office-entry instrumentation', () => {
  it('fires Manual Office Viewed carrying what the picker had on screen', async () => {
    renderFlow()

    await giveUpOnPickerAndFillManually()

    expect(eventProps(EVENTS.OnboardingV2.ManualOfficeViewed)).toMatchObject({
      officeZip: '78701',
      searchQuery: 'school board',
      categoryFilter: 'Local',
      totalOffices: 12,
      filteredCount: 0,
      searchErrored: false,
    })
  })

  it('reports the real office level on the manual path, not the string "manual"', async () => {
    renderFlow()

    await giveUpOnPickerAndFillManually()

    // Fires only after the campaign PUT and the organization PATCH resolve,
    // unlike the next-click event which is emitted before the persist starts.
    await waitFor(() =>
      expect(eventProps(EVENTS.OnboardingV2.OfficeCompleted)).toMatchObject({
        officePath: 'manual',
        officeLevel: 'LOCAL',
        officeName: 'Mayor',
      }),
    )
  })

  it('marks the office next-click with the path it came from', async () => {
    renderFlow()

    await giveUpOnPickerAndFillManually()

    expect(eventProps(EVENTS.OnboardingV2.OfficeNextClicked)).toMatchObject({
      officePath: 'manual',
    })
  })

  it('leaves give-up context off every other step view', async () => {
    renderFlow()

    await giveUpOnPickerAndFillManually()

    expect(eventProps(EVENTS.OnboardingV2.BallotStatusViewed)).toBeDefined()
    expect(
      eventProps(EVENTS.OnboardingV2.BallotStatusViewed),
    ).not.toHaveProperty('searchQuery')
    expect(eventProps(EVENTS.OnboardingV2.OfficeViewed)).not.toHaveProperty(
      'searchQuery',
    )
  })
})
