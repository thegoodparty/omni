import type { CampaignManagerContext } from '../../campaignManagerPrompt'

// A realistic candidate who has picked an office but has not filed: the state
// the ballot-access guidance is written for. Cases override ballotStatus and the
// filing dates to reach the other branches.
export const NOT_YET_FILED_FIXTURE: CampaignManagerContext = {
  candidateFirstName: 'Renee',
  candidateName: 'Renee Diaz',
  campaignId: 1,
  officeName: 'City Council',
  district: 'Ward 3',
  officeLevel: 'city',
  location: 'Springfield, IL',
  weeksToElection: 20,
  ballotStatus: 'qualified-not-filed',
  filingPeriodStart: '2026-09-01',
  filingPeriodEnd: '2026-09-15',
  daysToFilingDeadline: 27,
  topTasks: [],
  districtFilters: null,
  constituentToolEnabled: false,
  organization: null,
  crmToolsEnabled: false,
  savedFilterToolsEnabled: false,
  raceId: 'br-hash-springfield-ward-3',
  webSearchEnabled: true,
  story: null,
  plan: null,
}

// BallotReady returning a full filing record for the race.
export const BALLOT_DATA_FULL = {
  filingFee: 100,
  filingRequirementsText:
    '$100 filing fee and a nominating petition with 25 valid signatures ' +
    'from registered voters of the ward.',
  extractionSource: 'direct_dollar',
  filingOfficeAddress: '800 East Monroe Street, Springfield, IL 62701',
  filingPhoneNumber: '217-555-0142',
  paperworkInstructions:
    'File the declaration of candidacy and petition with the Sangamon ' +
    'County Clerk.',
}

// BallotReady has the race but no filing data for it — the case the tool
// reports as noDataFound.
export const BALLOT_DATA_EMPTY = {
  filingFee: null,
  filingRequirementsText: null,
  extractionSource: null,
  filingOfficeAddress: null,
  filingPhoneNumber: null,
  paperworkInstructions: null,
}
