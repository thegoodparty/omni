import filterSections, {
  legacyAgeOptions,
} from '../../[[...attr]]/components/configs/filters.config'
import { LANGUAGE_KEY_TO_CODE } from '../shared/voterFileFilterTransform.util'
import {
  ACTIVITY_CONDITION_ACTION_LABELS,
  ACTIVITY_CONDITION_CHANNELS,
  SUPPORT_STATUS_OPTIONS,
} from '../shared/activityConditionOptions'
import type { SegmentResponse } from '../shared/contacts-types'
import { sentenceCase } from '../shared/labels.util'
import { SectionLabel } from './ListDetailSection'

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

const CONTACTS_MADE_FIELD = filterSections
  .flatMap((section) => section.fields)
  .find((field) => field.key === 'contacts_made')

const isTrue = (value: unknown): value is true => value === true

// The Lovable summary reads as one plain sentence ("Age 18-25 or 35-50,
// Income ranges include Under $50k, and Support status Supporter."), so the
// clauses join with commas and a final "and" instead of the old
// "Label: value · Label: value" key-value chain.
const joinAsSentence = (clauses: string[]): string => {
  if (clauses.length === 1) return `${clauses[0]}.`
  if (clauses.length === 2) return `${clauses[0]} and ${clauses[1]}.`
  return `${clauses.slice(0, -1).join(', ')}, and ${clauses[clauses.length - 1]}.`
}

// Human-readable summary of a saved list's demographic + activity criteria
// (Lovable-locked sentence style, ENG-10725). Built entirely from the
// segment response plus the existing shared label maps (filters.config.ts,
// activityConditionOptions.tsx) so it cannot drift from the wizard that
// produced the criteria. Pure + synchronous by design — no outreach-name
// lookup — so it's cheap to unit test per clause combination.
export const buildFilterSummary = (
  segment: SegmentResponse,
  isElectedOfficial: boolean,
): string => {
  const clauses: string[] = []

  for (const section of filterSections) {
    for (const field of section.fields) {
      // Political party and voter likelihood don't apply to an elected
      // official's constituent file — same exclusions VoterFileStep.tsx
      // applies at creation time.
      if (
        isElectedOfficial &&
        (field.key === 'political_party' || field.key === 'voter_likely')
      )
        continue
      // Contacts Made gets its own "with N or M prior contacts made" clause
      // (ENG-10839, matching the product-specified wording) instead of the
      // generic "{Label} {value}" phrasing every other boolean-group field
      // uses — same skip-and-handle-separately pattern as language/income.
      if (field.key === 'contacts_made') continue
      if (field.key === 'language' || field.key === 'income_ranges') continue

      // Lists saved before ENG-10752 carry the retired age keys; without
      // this union an age-only legacy list would summarize as unfiltered.
      const options =
        field.key === 'age'
          ? [...field.options, ...legacyAgeOptions]
          : field.options
      const matched = options.filter((option) => isTrue(segment[option.key]))
      if (matched.length > 0) {
        clauses.push(
          `${sentenceCase(field.label)} ${matched.map((option) => option.label).join(' or ')}`,
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
    clauses.push(`Language ${labels.join(' or ')}`)
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
    clauses.push(`Income ranges include ${labels.join(' or ')}`)
  }

  // Win-only (ENG-10839): an eo- org's segment never has these fields set
  // (VoterFileStep hides the section, and the server rejects the filter),
  // but the isElectedOfficial gate is kept explicit for symmetry with the
  // political_party skip above.
  if (!isElectedOfficial) {
    const matched = (CONTACTS_MADE_FIELD?.options ?? []).filter((option) =>
      isTrue(segment[option.key]),
    )
    if (matched.length > 0) {
      clauses.push(
        `with ${matched.map((option) => option.label).join(' or ')} prior contacts made`,
      )
    }
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
    clauses.push(`Support status ${labels.join(' or ')}`)
  }

  if (typeof segment.search === 'string' && segment.search.trim()) {
    clauses.push(`matching search "${segment.search.trim()}"`)
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
        : (channelMeta?.anyLabel.toLowerCase() ??
          `any ${channelLabel} campaign`)
    const actionLabels = (condition.actions ?? []).map(
      (action) => ACTIVITY_CONDITION_ACTION_LABELS[action] ?? action,
    )
    const outcomePhrase =
      actionLabels.length > 0
        ? ` with outcome ${actionLabels.join(' or ')}`
        : ''
    clauses.push(
      `${channelLabel} activity from ${campaignPhrase}${outcomePhrase}`,
    )
  }

  if (clauses.length === 0) {
    return 'Everyone in your file — no filters applied.'
  }

  return joinAsSentence(clauses)
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
    <div className="flex flex-col gap-2">
      <SectionLabel>List filters</SectionLabel>
      <p className="text-sm text-muted-foreground">{summary}</p>
    </div>
  )
}
