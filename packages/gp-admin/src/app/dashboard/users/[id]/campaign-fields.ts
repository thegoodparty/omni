import { LAUNCH_STATUS } from './constants'
import type { BadgeColor, FieldType } from './types/field-config'

/**
 * Shared catalog of campaign fields, used by both the read-only display
 * (CampaignSection) and the edit form (CampaignForm). The catalog is the
 * single source of truth for each field's label and dot-path; per-side
 * presentation hints (badge color, input type, placeholder) live alongside.
 *
 * Fields without a `display` block are not rendered by the read-only view.
 * Fields without an `edit` block are not editable in the form.
 */

export type InputKind = 'text' | 'date' | 'email'

export interface DisplayHints {
  type: FieldType
  badgeColor?: BadgeColor
  trueBadgeColor?: BadgeColor
  falseBadgeColor?: BadgeColor
  fallback?: string
  colorMap?: Record<string, BadgeColor>
  defaultColor?: BadgeColor
}

export interface EditHints {
  inputType?: InputKind
  placeholder?: string
  hasError?: boolean
}

export interface FieldSpec {
  label: string
  display?: DisplayHints
  edit?: EditHints
}

export const CAMPAIGN_FIELDS = {
  // Top-level scalar flags
  isActive: {
    label: 'Active',
    display: { type: 'boolean', trueBadgeColor: 'green' },
  },
  isVerified: {
    label: 'Verified',
    display: { type: 'boolean', trueBadgeColor: 'blue' },
  },
  isPro: {
    label: 'Pro',
    display: { type: 'boolean', trueBadgeColor: 'violet' },
  },
  isDemo: {
    label: 'Demo Account',
    display: { type: 'boolean', trueBadgeColor: 'amber' },
  },
  didWin: {
    label: 'Won Election',
    display: { type: 'boolean', trueBadgeColor: 'green' },
  },
  canDownloadFederal: {
    label: 'Can Download Federal',
    display: { type: 'boolean', trueBadgeColor: 'green' },
  },
  tier: {
    label: 'Tier',
    display: {
      type: 'badge',
      badgeColor: 'blue',
      fallback: 'None',
    },
  },
  slug: { label: 'Slug', display: { type: 'text' } },
  createdAt: { label: 'Created', display: { type: 'date' } },
  updatedAt: { label: 'Updated', display: { type: 'date' } },
  dateVerified: {
    label: 'Date Verified',
    display: { type: 'date', fallback: 'Not verified' },
  },

  // data.*
  'data.name': {
    label: 'Campaign Name',
    display: { type: 'text' },
    edit: { placeholder: 'Campaign name' },
  },
  'data.adminUserEmail': {
    label: 'Admin User Email',
    edit: {
      inputType: 'email',
      placeholder: 'admin@example.com',
      hasError: true,
    },
  },
  'data.launchStatus': {
    label: 'Launch Status',
    display: {
      type: 'badge',
      colorMap: { [LAUNCH_STATUS.LAUNCHED]: 'green' },
      defaultColor: 'orange',
      fallback: LAUNCH_STATUS.NOT_LAUNCHED,
    },
  },
  'data.lastVisited': { label: 'Last Visited', display: { type: 'date' } },
  'data.lastStepDate': { label: 'Last Step Date', display: { type: 'text' } },
  'data.currentStep': { label: 'Current Step', display: { type: 'text' } },

  // details.* — Location
  'details.state': {
    label: 'State',
    display: { type: 'text' },
    edit: { placeholder: 'State' },
  },
  'details.city': {
    label: 'City',
    display: { type: 'text' },
    edit: { placeholder: 'City' },
  },
  'details.county': {
    label: 'County',
    display: { type: 'text' },
    edit: { placeholder: 'County' },
  },
  'details.zip': {
    label: 'ZIP',
    display: { type: 'text' },
    edit: { placeholder: 'ZIP' },
  },

  // details.* — Office
  'details.ballotLevel': {
    label: 'Ballot Level',
    display: { type: 'badge', badgeColor: 'blue', fallback: 'Not set' },
  },
  'details.level': {
    label: 'Election Level',
    display: { type: 'badge', badgeColor: 'iris', fallback: 'Not set' },
  },
  'details.officeTermLength': {
    label: 'Term Length',
    display: { type: 'text' },
    edit: { placeholder: 'e.g., 4 years' },
  },

  // details.* — Election
  'details.electionDate': {
    label: 'Election Date',
    display: { type: 'text' },
    edit: { inputType: 'date' },
  },
  'details.primaryElectionDate': {
    label: 'Primary Election Date',
    edit: { inputType: 'date' },
  },
  'details.partisanType': {
    label: 'Partisan Type',
    display: { type: 'text' },
    edit: { placeholder: 'e.g., partisan, nonpartisan' },
  },

  // details.* — Filing Period
  'details.filingPeriodsStart': {
    label: 'Filing Start',
    display: { type: 'text' },
    edit: { inputType: 'date' },
  },
  'details.filingPeriodsEnd': {
    label: 'Filing End',
    display: { type: 'text' },
    edit: { inputType: 'date' },
  },

  // details.* — Party
  'details.party': {
    label: 'Party',
    display: { type: 'text' },
    edit: { placeholder: 'Party' },
  },
  'details.otherParty': {
    label: 'Other Party',
    edit: { placeholder: 'Other party' },
  },

  // details.* — Background
  'details.occupation': {
    label: 'Occupation',
    display: { type: 'text' },
    edit: { placeholder: 'Occupation' },
  },
  'details.website': {
    label: 'Website',
    display: { type: 'text' },
    edit: { placeholder: 'https://...', hasError: true },
  },
  'details.pledged': {
    label: 'Pledged',
    display: { type: 'boolean', trueBadgeColor: 'green' },
  },
} as const satisfies Record<string, FieldSpec>

export type CampaignFieldKey = keyof typeof CAMPAIGN_FIELDS

export interface DisplayFieldConfig {
  key: string
  label: string
  type: FieldType
  badgeColor?: BadgeColor
  trueBadgeColor?: BadgeColor
  falseBadgeColor?: BadgeColor
  fallback?: string
  colorMap?: Record<string, BadgeColor>
  defaultColor?: BadgeColor
}

export interface EditFieldConfig<TKey extends string = string> {
  key: TKey
  label: string
  placeholder: string
  inputType?: InputKind
  hasError?: boolean
}

/**
 * Build display configs (for FieldList) from a list of catalog keys.
 * Throws at module load if a key is missing display hints — keeps the
 * shared catalog honest.
 */
export function buildDisplayFields(
  keys: readonly CampaignFieldKey[],
): DisplayFieldConfig[] {
  return keys.map((key) => {
    const spec: FieldSpec = CAMPAIGN_FIELDS[key]
    if (!spec.display) {
      throw new Error(`Field "${key}" has no display hints in CAMPAIGN_FIELDS`)
    }
    return { key, label: spec.label, ...spec.display }
  })
}

/**
 * Build edit configs (for the form) from a list of catalog keys. The generic
 * lets callers narrow `key` to their form's `Path<TFormData>` type.
 */
export function buildEditFields<TKey extends string = string>(
  keys: readonly CampaignFieldKey[],
): EditFieldConfig<TKey>[] {
  return keys.map((key) => {
    const spec: FieldSpec = CAMPAIGN_FIELDS[key]
    if (!spec.edit) {
      throw new Error(`Field "${key}" has no edit hints in CAMPAIGN_FIELDS`)
    }
    return {
      key: key as TKey,
      label: spec.label,
      placeholder: spec.edit.placeholder ?? '',
      inputType: spec.edit.inputType,
      hasError: spec.edit.hasError,
    }
  })
}
