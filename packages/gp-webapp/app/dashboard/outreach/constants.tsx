import {
  MdOutlineSignalCellularAlt,
  MdOutlineSignalCellularAlt1Bar,
  MdOutlineSignalCellularAlt2Bar,
} from 'react-icons/md'
import type { AudienceFilterCamelKey } from 'app/dashboard/outreach/util/audienceFilterKeyMap'

interface ImpactLevels {
  low: 'low'
  medium: 'medium'
  high: 'high'
}

export const IMPACTS_LEVELS: ImpactLevels = {
  low: 'low',
  medium: 'medium',
  high: 'high',
}

interface ImpactLevelIcons {
  low: React.JSX.Element
  medium: React.JSX.Element
  high: React.JSX.Element
}

export const IMPACT_LEVEL_ICONS: ImpactLevelIcons = {
  low: <MdOutlineSignalCellularAlt1Bar />,
  medium: <MdOutlineSignalCellularAlt2Bar />,
  high: <MdOutlineSignalCellularAlt />,
}

interface ImpactLevelLabels {
  low: string
  medium: string
  high: string
}

export const IMPACT_LEVELS_LABELS: ImpactLevelLabels = {
  low: 'Low Impact',
  medium: 'Medium Impact',
  high: 'High Impact',
}

type OutreachTypeKey =
  | 'text'
  | 'p2p'
  | 'p2pTexting'
  | 'doorKnocking'
  | 'phoneBanking'
  | 'nativePhoneBanking'
  | 'socialMedia'
  | 'robocall'

type OutreachTypeMapping = {
  [K in OutreachTypeKey]?: string
}

export const OUTREACH_TYPE_MAPPING: OutreachTypeMapping = {
  p2pTexting: 'Text message',
  doorKnocking: 'Door knocking',
  phoneBanking: 'Phone banking',
  socialMedia: 'Social post',
}

// Audience keys share the canonical camelCase vocabulary from audienceFilterKeyMap.
export type AudienceLabelKey = AudienceFilterCamelKey

export const AUDIENCE_LABELS_MAPPING: Record<AudienceLabelKey, string> = {
  audienceSuperVoters: 'Super',
  audienceLikelyVoters: 'Likely',
  audienceUnreliableVoters: 'Unreliable',
  audienceUnlikelyVoters: 'Unlikely',
  // 'Unknown Voters', not 'Unknown': genderUnknown below maps to 'Unknown'
  // too, and formatAudienceLabels flattens both into one chip list.
  audienceUnknown: 'Unknown Voters',
  partyIndependent: 'Independent',
  partyDemocrat: 'Democrat',
  partyRepublican: 'Republican',
  partyOther: 'Other',
  age18_25: '18-25',
  age25_35: '25-35',
  age35_50: '35-50',
  age50Plus: '50+',
  age18_24: '18-24',
  age25_34: '25-34',
  age35_49: '35-49',
  age50_64: '50-64',
  age65Plus: '65+',
  genderMale: 'Male',
  genderFemale: 'Female',
  genderUnknown: 'Unknown',
}

interface OutreachTypes {
  text: 'text'
  p2p: 'p2p'
  doorKnocking: 'doorKnocking'
  nativeDoorKnocking: 'nativeDoorKnocking'
  phoneBanking: 'phoneBanking'
  nativePhoneBanking: 'nativePhoneBanking'
  socialMedia: 'socialMedia'
  robocall: 'robocall'
}

// Based off the OutreachType in gp-api
export const OUTREACH_TYPES: OutreachTypes = {
  text: 'text',
  p2p: 'p2p',
  doorKnocking: 'doorKnocking',
  nativeDoorKnocking: 'nativeDoorKnocking',
  phoneBanking: 'phoneBanking',
  nativePhoneBanking: 'nativePhoneBanking',
  socialMedia: 'socialMedia',
  robocall: 'robocall',
}

interface OutreachActionsTypes {
  copyScript: 'copyScript'
  downloadAudience: 'downloadAudience'
}

export const OUTREACH_ACTIONS_TYPES: OutreachActionsTypes = {
  copyScript: 'copyScript',
  downloadAudience: 'downloadAudience',
}

interface FreeTextsOffer {
  COUNT: number
}

export const FREE_TEXTS_OFFER: FreeTextsOffer = {
  COUNT: 5000,
}
