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

// people-api's POST /v1/people/aggregates response (ENG-10706) — a filtered
// COUNT/AVG(age)/AVG(income) over a list's membership.
export type PeopleAggregatesResponse = {
  count: number
  avgAge: number | null
  avgIncome: number | null
}
