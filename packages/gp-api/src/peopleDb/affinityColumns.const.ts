// The independentAffinity filter reads one of these columns, picked per
// campaign by the `independent-model-used` experiment. A column is an
// identifier and can't be bound, so the SQL builder checks it against this list
// before interpolating it.
export const AFFINITY_COLUMNS = [
  'Voter_Independent_Affinity',
  'Indep_Openness_Registration',
  'Indep_Openness_Haystaq',
  'Indep_Openness_Single_Inc',
  'Indep_Openness_Single_Open',
  'Indep_Openness_Multi_Inc',
  'Indep_Openness_Multi_Open',
  'Indep_Openness_DOnly_Inc',
  'Indep_Openness_DOnly_Open',
  'Indep_Openness_ROnly_Inc',
  'Indep_Openness_ROnly_Open',
  'Indep_Openness_DOnly_Multi',
  'Indep_Openness_ROnly_Multi',
] as const

export type AffinityColumn = (typeof AFFINITY_COLUMNS)[number]

// What every campaign read before the experiment; still read by campaigns
// outside it.
export const DEFAULT_AFFINITY_COLUMN: AffinityColumn =
  'Voter_Independent_Affinity'
