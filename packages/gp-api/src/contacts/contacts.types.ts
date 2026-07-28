// people-api's POST /v1/people/aggregates response (ENG-10706) is a
// cross-service shape, so its type lives in contracts (ENG-10775 added the
// `fenced` flag there) — re-exported here so existing importers don't churn.
export type { PeopleAggregatesResponse } from '@goodparty_org/contracts'

// Stable error code returned when a campaign cannot use the People-API voter
// data path (district can't be resolved, or the campaign fails the
// federal/state download-access rule). The webapp maps it to a clean
// empty/ineligible state instead of treating the 4xx as an error.
export const VOTER_DATA_UNAVAILABLE_ERROR_CODE = 'VOTER_DATA_UNAVAILABLE'

export type DistrictStatsBucket = {
  label: string
  count: number
  percent: number
}

export type DistrictStatCategory = DistrictStatsBucket[]

export type StatsResponse = {
  districtId: string
  computedAt?: string
  totalConstituents: number
  totalConstituentsWithCellPhone: number
  buckets: {
    age: DistrictStatCategory
    homeowner: DistrictStatCategory
    education: DistrictStatCategory
    presenceOfChildren: DistrictStatCategory
    estimatedIncomeRange: DistrictStatCategory
  }
}
