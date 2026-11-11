import {
  BallotReadyPositionLevel,
  CampaignLaunchStatus,
  OnboardingStep,
} from '@goodparty_org/contracts'
import { Campaign, CampaignTier } from '../../../generated/prisma'
import { generateFactory } from './generate'

let campaignCounter = 1

export function resetCampaignCounter() {
  campaignCounter = 1
}

export const campaignFactory = generateFactory<Campaign>((args) => {
  // skip incrementing when id is provided so slug stays consistent with the given id
  const id = 'id' in args ? (args.id as number) : campaignCounter++
  const organizationSlug = `campaign-${id}`
  return {
    id,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    organizationSlug: organizationSlug,
    slug: `test-campaign-${id}`,
    isActive: true,
    isVerified: false,
    isPro: false,
    isDemo: false,
    didWin: null,
    dateVerified: null,
    tier: CampaignTier.TOSSUP,
    formattedAddress: null,
    placeId: null,
    userId: 1,
    data: {
      currentStep: OnboardingStep.complete,
      launchStatus: CampaignLaunchStatus.launched,
    },
    details: {
      state: 'CA',
      zip: '90210',
      ballotLevel: BallotReadyPositionLevel.CITY,
      electionDate: '2024-11-05',
      primaryElectionDate: '2024-06-05',
      geoLocation: {},
      party: 'Independent',
      raceId: `race-${id}`,
      pledged: true,
      knowRun: 'yes',
      runForOffice: 'yes',
    },
    aiContent: {},
    vendorTsData: {},
    canDownloadFederal: false,
    hasFreeTextsOffer: false,
    freeTextsOfferRedeemedAt: null,
  }
})
