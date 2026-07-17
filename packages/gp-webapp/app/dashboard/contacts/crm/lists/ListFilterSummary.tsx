import { ListChecksIcon } from '@styleguide'
import filterSections from '../../[[...attr]]/components/configs/filters.config'
import { LANGUAGE_KEY_TO_CODE } from '../shared/voterFileFilterTransform.util'
import {
  ACTIVITY_CONDITION_ACTION_LABELS,
  ACTIVITY_CONDITION_CHANNELS,
  SUPPORT_STATUS_OPTIONS,
} from '../shared/activityConditionOptions'
import type { SegmentResponse } from '../shared/contacts-types'
import { InfoSection } from '../person/InfoSection'

// Reverse of LANGUAGE_KEY_TO_CODE (languageEnglish -> en), built from the
// same single-source filters.config.ts labels + voterFileFilterTransform's
// code map so this can't drift from either (ENG-10707).
const LANGUAGE_FIELD = filterSections
  .flatMap((section) => section.fields)
  .find((field) => field.key === 'language')

const CODE_TO_LANGUAGE_LABEL: Record<string, string> = (
  LANGUAGE_FIELD?.options ?? []
).reduce<Record<string, string>>((labelByCode, option) => {
  const code = LANGUAGE_KEY_TO_CODE[option.key]
  if (code) labelByCode[code] = option.label
  return labelByCode
}, {})

const INCOME_FIELD = filterSections
  .flatMap((section) => section.fields)
  .find((field) => field.key === 'income_ranges')

const INCOME_UNKNOWN_LABEL =
  INCOME_FIELD?.options.find((option) => option.key === 'incomeUnknown')
    ?.label ?? 'Unknown'

const isTrue = (value: unknown): value is true => value === true

// Human-readable summary of a saved list's demographic + activity criteria
// (locked design: "People aged 18-35 who were in 'GOTV text blast' and
// didn't respond"). Built entirely from the segment response plus the
// existing shared label maps (filters.config.ts, activityConditionOptions.tsx)
// so it cannot drift from the wizard that produced the criteria (task 09).
// Pure + synchronous by design — no outreach-name lookup — so it's cheap to
// unit test per clause combination.
export const buildFilterSummary = (
  segment: SegmentResponse,
  isElectedOfficial: boolean,
): string => {
  const clauses: string[] = []

  for (const section of filterSections) {
    for (const field of section.fields) {
      // Political party doesn't apply to an elected official's constituent
      // file — same exclusion VoterFileStep.tsx applies at creation time.
      if (isElectedOfficial && field.key === 'political_party') continue
      if (field.key === 'language' || field.key === 'income_ranges') continue

      const matched = field.options.filter((option) =>
        isTrue(segment[option.key]),
      )
      if (matched.length > 0) {
        clauses.push(
          `${field.label}: ${matched.map((option) => option.label).join(' or ')}`,
        )
      }
    }
  }

  const languageCodes = Array.isArray(segment.languageCodes)
    ? (segment.languageCodes as string[])
    : []
  if (languageCodes.length > 0) {
    const labels = languageCodes.map(
      (code) => CODE_TO_LANGUAGE_LABEL[code] ?? code,
    )
    clauses.push(`Language: ${labels.join(' or ')}`)
  }

  const incomeRanges = Array.isArray(segment.incomeRanges)
    ? (segment.incomeRanges as string[])
    : []
  const incomeUnknown = isTrue(segment.incomeUnknown)
  if (incomeRanges.length > 0 || incomeUnknown) {
    const labels = [
      ...incomeRanges,
      ...(incomeUnknown ? [INCOME_UNKNOWN_LABEL] : []),
    ]
    clauses.push(`Household Income: ${labels.join(' or ')}`)
  }

  const supportStatus = Array.isArray(segment.supportStatus)
    ? segment.supportStatus
    : []
  if (supportStatus.length > 0) {
    const labels = supportStatus.map(
      (value) =>
        SUPPORT_STATUS_OPTIONS.find((option) => option.value === value)
          ?.label ?? value,
    )
    clauses.push(`Support Status: ${labels.join(' or ')}`)
  }

  if (typeof segment.search === 'string' && segment.search.trim()) {
    clauses.push(`Matching search "${segment.search.trim()}"`)
  }

  const activityConditions = Array.isArray(segment.activityConditions)
    ? segment.activityConditions
    : []
  for (const condition of activityConditions) {
    const channelMeta = ACTIVITY_CONDITION_CHANNELS.find(
      (channel) => channel.value === condition.outreachType,
    )
    const channelLabel = channelMeta?.label ?? condition.outreachType
    const campaignPhrase =
      condition.outreachId != null
        ? 'a specific campaign'
        : (channelMeta?.anyLabel ?? `any ${channelLabel} campaign`)
    const actionLabels = (condition.actions ?? []).map(
      (action) => ACTIVITY_CONDITION_ACTION_LABELS[action] ?? action,
    )
    const outcomePhrase =
      actionLabels.length > 0 ? ` (${actionLabels.join(', ')})` : ''
    clauses.push(`${channelLabel} — ${campaignPhrase}${outcomePhrase}`)
  }

  if (clauses.length === 0) {
    return 'Everyone in your file — no filters applied.'
  }

  return clauses.join(' · ')
}

interface ListFilterSummaryProps {
  segment: SegmentResponse
  isElectedOfficial: boolean
}

export default function ListFilterSummary({
  segment,
  isElectedOfficial,
}: ListFilterSummaryProps) {
  const summary = buildFilterSummary(segment, isElectedOfficial)

  return (
    <InfoSection title="List Filters" icon={<ListChecksIcon size={20} />}>
      <p className="text-sm text-muted-foreground">{summary}</p>
    </InfoSection>
  )
}
