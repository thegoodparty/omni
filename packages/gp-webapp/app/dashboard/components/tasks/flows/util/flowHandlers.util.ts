import { format } from 'date-fns'
import { createOutreach } from 'helpers/createOutreach'
import { createVoterFileFilter } from 'helpers/createVoterFileFilter'
import { createP2pPhoneList, PhoneListInput } from 'helpers/createP2pPhoneList'
import { noop, noopAsync } from '@shared/utils/noop'
import { getEffectiveOutreachType } from 'app/dashboard/outreach/util/getEffectiveOutreachType'
import { FREE_TEXTS_OFFER } from 'app/dashboard/outreach/constants'
import { DISPLAY_TASK_TYPES } from 'app/dashboard/shared/constants/tasks.const'
import { VoterFileFilters } from 'helpers/types'
import { Outreach } from 'app/dashboard/outreach/hooks/OutreachContext'
import { OutreachType } from 'gpApi/types/outreach.types'
import {
  AUDIENCE_FILTER_SNAKE_KEYS,
  AudienceFilterCamelKey,
  snakeToCamelAudienceKey,
} from 'app/dashboard/outreach/util/audienceFilterKeyMap'

const PEERLY_DEFAULT_IMAGE_TITLE = `P2P Outreach - Campaign`

// AudienceState uses underscore keys for frontend form state (CustomVoterAudienceFilters)
// This differs from VoterFileFilters which uses camelCase for API persistence
export interface AudienceState {
  audience_request?: string | boolean
  count?: number
  audience_superVoters?: boolean
  audience_likelyVoters?: boolean
  audience_unreliableVoters?: boolean
  audience_unlikelyVoters?: boolean
  audience_firstTimeVoters?: boolean
  party_independent?: boolean
  party_democrat?: boolean
  party_republican?: boolean
  age_18_25?: boolean
  age_25_35?: boolean
  age_35_50?: boolean
  age_50_plus?: boolean
  gender_male?: boolean
  gender_female?: boolean
  gender_unknown?: boolean
}

export interface ScheduleState {
  date?: Date | string
  message?: string
}

export interface FlowState {
  script?: string | false | null
  schedule?: ScheduleState
  image?: File | null
  voterFileFilter?: (PhoneListInput & { id?: number }) | null
  audience?: AudienceState
  phoneListId?: number | null
}

interface CreateOutreachParams {
  type: OutreachType
  state: FlowState
  campaignId: number
  campaignPlanDueDate?: string
  textCount?: number
  hasFreeTextsOffer?: boolean
  outreaches?: Outreach[]
  setOutreaches?: (outreaches: Outreach[]) => void
  errorSnackbar?: (message: string) => void
  refreshCampaign?: () => Promise<void>
  p2pUxEnabled?: boolean
}

interface CreateVoterFileFilterParams {
  type: OutreachType
  state: {
    audience?: AudienceState
    voterCount?: number
  }
  errorSnackbar?: (message: string) => void
  // Injectable for deterministic tests; the name carries the send date so
  // candidates can tell auto-created lists apart (ENG-10521).
  now?: Date
}

// Auto-created outreach filters get a name carrying the send date so candidates
// can tell them apart (ENG-10521). They're still throwaways created on every
// send, not lists a candidate built — AUTO_VOTER_FILTER_NAME_PATTERN keeps them
// out of the saved-list selector (ENG-10514). Both live here so the produced
// name and the matcher that hides it can't drift apart.
const AUTO_VOTER_FILTER_NAME_SUFFIX = ' outreach — '

const buildAutoVoterFileFilterName = (
  type: OutreachType,
  now: Date,
): string => {
  const label = DISPLAY_TASK_TYPES[type] || type
  return `${label}${AUTO_VOTER_FILTER_NAME_SUFFIX}${format(now, 'MMM d, yyyy')}`
}

export const AUTO_VOTER_FILTER_NAME_PATTERN = new RegExp(
  `${AUTO_VOTER_FILTER_NAME_SUFFIX.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  )}[A-Z][a-z]{2} \\d{1,2}, \\d{4}$`,
)

// MappedAudience is the subset of VoterFileFilters used for audience mapping
type MappedAudience = Pick<VoterFileFilters, AudienceFilterCamelKey>

export const handleCreateOutreach =
  ({
    type,
    state: { script, schedule, image, voterFileFilter, audience, phoneListId },
    campaignId,
    campaignPlanDueDate,
    textCount,
    hasFreeTextsOffer = false,
    outreaches = [],
    setOutreaches = noop,
    errorSnackbar = noop,
    refreshCampaign = noopAsync,
    p2pUxEnabled = true,
  }: CreateOutreachParams) =>
  async (options?: { draft?: boolean }): Promise<Outreach | undefined> => {
    const { audience_request: audienceRequest } = audience || {}
    const { message } = schedule || {}
    const date = schedule?.date
    const voterFileFilterId = voterFileFilter?.id
    const outreachType = getEffectiveOutreachType(type, p2pUxEnabled)
    const draft = options?.draft

    const discount = hasFreeTextsOffer
      ? Math.min(textCount ?? 0, FREE_TEXTS_OFFER.COUNT)
      : 0
    const textCounts =
      textCount === undefined
        ? {}
        : { textCount, billableTextCount: textCount - discount }

    const outreach = await createOutreach(
      {
        campaignId,
        outreachType,
        message,
        title: `${PEERLY_DEFAULT_IMAGE_TITLE} ${campaignId}`,
        script: typeof script === 'string' ? script : undefined,
        ...(date
          ? { date: date instanceof Date ? date.toISOString() : date }
          : {}),
        ...(voterFileFilterId && voterFileFilterId > 0
          ? { voterFileFilterId }
          : {}),
        ...(typeof audienceRequest === 'string' && audienceRequest
          ? { audienceRequest }
          : {}),
        ...(p2pUxEnabled && phoneListId && phoneListId > 0
          ? { phoneListId }
          : {}),
        ...(campaignPlanDueDate ? { campaignPlanDueDate } : {}),
        ...textCounts,
        ...(draft ? { draft: true } : {}),
      },
      image || null,
    )

    if (!outreach) {
      errorSnackbar('There was an error creating your outreach campaign')
      return
    }

    // Drafts are hidden server-side until payment finalizes them — appending
    // one to the visible list would show a phantom campaign.
    if (!draft) {
      setOutreaches([...outreaches, outreach])
      await refreshCampaign()
    }

    return outreach
  }

// Translates the underscore-keyed audience form state into the camelCase
// VoterFileFilters shape the API persists, keeping only the selected (truthy)
// audiences. The snake_case <-> camelCase vocabulary lives in audienceFilterKeyMap.
export const mapAudienceForPersistence = (
  audience: AudienceState = {},
): MappedAudience =>
  AUDIENCE_FILTER_SNAKE_KEYS.reduce<MappedAudience>((acc, snakeKey) => {
    const value = audience[snakeKey]
    return value ? { ...acc, [snakeToCamelAudienceKey(snakeKey)]: value } : acc
  }, {})

export const handleCreatePhoneList =
  (errorSnackbar: (message: string) => void = noop) =>
  async (
    voterFileFilter: PhoneListInput | undefined,
  ): Promise<string | undefined> => {
    const result = await createP2pPhoneList(voterFileFilter)

    if (!result.ok) {
      const fallback =
        'There was an error generating a phone list. Please try again.'
      errorSnackbar(result.message || fallback)
      return
    }
    return result.token
  }

export const handleCreateVoterFileFilter =
  ({
    type,
    state: { audience, voterCount },
    errorSnackbar = noop,
    now = new Date(),
  }: CreateVoterFileFilterParams) =>
  async (): Promise<PhoneListInput | undefined> => {
    const chosenAudiences = mapAudienceForPersistence(audience)

    const voterFileFilter = await createVoterFileFilter({
      name: buildAutoVoterFileFilterName(type, now),
      ...chosenAudiences,
      voterCount,
    })

    if (!voterFileFilter) {
      errorSnackbar('There was an error creating your voter file filter')
      return
    }

    return voterFileFilter
  }
