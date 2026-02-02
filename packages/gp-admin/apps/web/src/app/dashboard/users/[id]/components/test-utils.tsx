import { render, RenderOptions } from '@testing-library/react'
import { ReactElement } from 'react'
import { UserProvider } from '../UserProvider'
import type { DetailedUser } from '../types'

// Minimal mock user for testing
export const mockUser: DetailedUser = {
  id: 1,
  createdAt: '2023-04-02T05:51:59.450Z',
  updatedAt: '2026-01-29T03:50:12.433Z',
  slug: 'test-user',
  isActive: true,
  isVerified: true,
  isPro: true,
  isDemo: false,
  didWin: true,
  dateVerified: '2024-01-15T00:00:00.000Z',
  tier: 3,
  formattedAddress: null,
  placeId: null,
  data: {
    id: 1,
    name: 'Test User',
    slug: 'test-user',
    team: { completed: true },
    image: 'https://example.com/avatar.png',
    launch: { 'website-0': true },
    social: { completed: true },
    finance: { ein: true },
    profile: { completed: true },
    aiContent: {},
    hubspotId: 'HS-98765',
    currentStep: 'onboarding-complete',
    lastVisited: 1700000000000,
    campaignPlan: {},
    hasVoterFile: 'completed',
    lastStepDate: '2024-04-03',
    launchStatus: 'launched',
    hubSpotUpdates: {},
    customVoterFiles: [],
    textCampaignCount: 2,
    campaignPlanStatus: {},
    reportedVoterGoals: {},
    path_to_victory_status: 'Complete',
  },
  details: {
    dob: '1990-01-01',
    zip: '12345',
    city: 'Test City',
    tier: 3,
    level: 'city',
    party: 'Independent',
    phone: '5551234567',
    state: 'CA',
    county: 'Test County',
    office: 'Mayor',
    raceId: 'race-123',
    citizen: 'yes',
    funFact: 'Test fun fact',
    knowRun: 'yes',
    pledged: true,
    website: 'https://example.com',
    articles: '',
    lastName: 'User',
    firstName: 'Test',
    runBefore: 'no',
    topIssues: { positions: [] },
    electionId: 'election-123',
    hasPrimary: true,
    occupation: 'Engineer',
    otherParty: '',
    positionId: 'position-123',
    ballotLevel: 'CITY',
    geoLocation: { lat: 34.0522, lng: -118.2437 },
    noCommittee: false,
    otherOffice: '',
    customIssues: [],
    electionDate: '2026-11-03',
    partisanType: 'nonpartisan',
    runForOffice: 'yes',
    campaignPhone: '5559876543',
    filedStatement: 'yes',
    pastExperience: 'Previous experience details',
    runningAgainst: [
      {
        name: 'Jane Smith',
        party: 'Democrat',
        description: 'Incumbent candidate',
      },
    ],
    campaignWebsite: '',
    officeRunBefore: '',
    filingPeriodsEnd: '2026-07-17',
    officeTermLength: '4 years',
    campaignCommittee: '',
    filingPeriodsStart: '2026-07-03',
    priorElectionDates: [],
  },
  aiContent: {},
  vendorTsData: {},
  userId: 123,
  canDownloadFederal: true,
  completedTaskIds: ['task-1', 'task-2'],
  hasFreeTextsOffer: false,
  freeTextsOfferRedeemedAt: null,
  pathToVictory: {
    id: 1,
    createdAt: '2024-05-10T02:01:15.810Z',
    updatedAt: '2025-08-13T20:43:03.191Z',
    campaignId: 1,
    data: {
      men: 23793,
      asian: 13145,
      white: 10138,
      women: 25651,
      indies: 16270,
      source: 'ElectionApi',
      hispanic: 18755,
      democrats: 30017,
      p2vStatus: 'Complete',
      viability: {
        level: 'city',
        score: 2.25,
        seats: 1,
        candidates: '3',
        isPartisan: false,
        isIncumbent: 'false',
        isUncontested: 'false',
        candidatesPerSeat: '3',
      },
      winNumber: 3142,
      republicans: 6991,
      electionType: 'City',
      averageTurnout: 16291,
      africanAmerican: 318,
      p2vCompleteDate: '2025-08-13',
      electionLocation: 'TEST CITY',
      projectedTurnout: 6282,
      voterContactGoal: 15710,
      totalRegisteredVoters: 53278,
    },
  },
}

// Mock user without elected office (didWin = false)
export const mockUserNoElectedOffice: DetailedUser = {
  ...mockUser,
  didWin: false,
}

// Mock user without P2V data
export const mockUserNoP2V: DetailedUser = {
  ...mockUser,
  pathToVictory: {
    ...mockUser.pathToVictory,
    data: undefined as unknown as typeof mockUser.pathToVictory.data,
  },
}

interface WrapperProps {
  children: React.ReactNode
}

function createWrapper(user: DetailedUser = mockUser) {
  return function Wrapper({ children }: WrapperProps) {
    return <UserProvider user={user}>{children}</UserProvider>
  }
}

export function renderWithUser(
  ui: ReactElement,
  user: DetailedUser = mockUser,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, { wrapper: createWrapper(user), ...options })
}
