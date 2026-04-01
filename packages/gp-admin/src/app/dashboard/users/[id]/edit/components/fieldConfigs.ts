import { INPUT_TYPE, type InputType } from '../constants'
import type { Path } from 'react-hook-form'
import type { PathToVictoryFormData } from '../schema'

export type FieldPath = Path<PathToVictoryFormData>

export interface FieldConfig {
  key: FieldPath
  label: string
  placeholder: string
  type?: InputType
  step?: string
  minWidth?: string
  formula?: boolean
}

export const numberFieldOptions = {
  setValueAs: (v: string) => {
    if (v === '' || v === null || v === undefined) return undefined
    const num = Number(v)
    return isNaN(num) ? undefined : num
  },
}

export const TARGET_NUMBER_FIELDS: FieldConfig[] = [
  {
    key: 'winNumber',
    label: 'Win Number',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    formula: true,
  },
  {
    key: 'voterContactGoal',
    label: 'Voter Contact Goal',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    formula: true,
  },
  {
    key: 'totalRegisteredVoters',
    label: 'Total Registered Voters',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
  },
  {
    key: 'projectedTurnout',
    label: 'Projected Turnout',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
  },
  {
    key: 'averageTurnout',
    label: 'Average Turnout',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
  },
]

export const PARTY_FIELDS: FieldConfig[] = [
  {
    key: 'republicans',
    label: 'Republicans',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    minWidth: '120px',
  },
  {
    key: 'democrats',
    label: 'Democrats',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    minWidth: '120px',
  },
  {
    key: 'indies',
    label: 'Independents',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    minWidth: '120px',
  },
]

export const GENDER_FIELDS: FieldConfig[] = [
  { key: 'men', label: 'Men', placeholder: '0', type: INPUT_TYPE.NUMBER },
  { key: 'women', label: 'Women', placeholder: '0', type: INPUT_TYPE.NUMBER },
]

export const RACE_FIELDS: FieldConfig[] = [
  {
    key: 'white',
    label: 'White',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    minWidth: '120px',
  },
  {
    key: 'asian',
    label: 'Asian',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    minWidth: '120px',
  },
  {
    key: 'africanAmerican',
    label: 'African American',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    minWidth: '120px',
  },
  {
    key: 'hispanic',
    label: 'Hispanic',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    minWidth: '120px',
  },
]

export const VIABILITY_FIELDS: FieldConfig[] = [
  { key: 'viability.level', label: 'Level', placeholder: 'Level' },
  {
    key: 'viability.seats',
    label: 'Seats',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    minWidth: '100px',
  },
  {
    key: 'viability.candidates',
    label: 'Candidates',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    minWidth: '100px',
  },
  {
    key: 'viability.candidatesPerSeat',
    label: 'Candidates/Seat',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    step: '0.01',
    minWidth: '120px',
  },
  {
    key: 'viability.score',
    label: 'Score',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    step: '0.01',
    minWidth: '100px',
  },
  {
    key: 'viability.probOfWin',
    label: 'Prob. of Win',
    placeholder: '0',
    type: INPUT_TYPE.NUMBER,
    step: '0.01',
    minWidth: '120px',
  },
]

export type ViabilityBooleanField =
  | 'isPartisan'
  | 'isIncumbent'
  | 'isUncontested'

export const VIABILITY_BOOLEAN_FIELDS: {
  key: ViabilityBooleanField
  label: string
}[] = [
  { key: 'isPartisan', label: 'Partisan' },
  { key: 'isIncumbent', label: 'Incumbent' },
  { key: 'isUncontested', label: 'Uncontested' },
]
