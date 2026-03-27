export type DistrictTypeItem = {
  id: string
  L2DistrictType: string
}

export type DistrictNameItem = {
  id: string
  L2DistrictName: string
}

export type ListDistrictTypesOptions = {
  state: string
  electionYear: number
  excludeInvalid?: boolean
}

export type ListDistrictNamesOptions = {
  state: string
  electionYear: number
  L2DistrictType: string
  excludeInvalid?: boolean
}

export type UpdateDistrictInput = {
  L2DistrictType: string
  L2DistrictName: string
}
