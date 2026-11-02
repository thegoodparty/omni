// people-api's POST /v1/people/aggregates response (ENG-10706) is a
// cross-service shape, so its type lives in contracts (ENG-10775 added the
// `fenced` flag there) — re-exported here so existing importers don't churn.
export type { PeopleAggregatesResponse } from '@goodparty_org/contracts'

// Moved to shared/ so peopleDb can raise it too — re-exported here so
// existing importers don't churn.
export { VOTER_DATA_UNAVAILABLE_ERROR_CODE } from '@/shared/constants/voterData.consts'

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
  districtPopulation: number | null
  // A Win campaign with imported contacts: the people only an import added,
  // counted next to the voters above rather than inside them.
  newContactsCount?: number
  buckets: {
    age: DistrictStatCategory
    homeowner: DistrictStatCategory
    education: DistrictStatCategory
    presenceOfChildren: DistrictStatCategory
    estimatedIncomeRange: DistrictStatCategory
  }
}
