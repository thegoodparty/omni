import { UserRole } from '@goodparty_org/sdk'

/** @see https://react-hook-form.com/docs/useform#mode */
export const FORM_MODE = {
  ON_CHANGE: 'onChange',
  ON_BLUR: 'onBlur',
  ON_SUBMIT: 'onSubmit',
  ON_TOUCHED: 'onTouched',
  ALL: 'all',
} as const

export type FormMode = (typeof FORM_MODE)[keyof typeof FORM_MODE]

export const INPUT_TYPE = {
  TEXT: 'text',
  EMAIL: 'email',
  NUMBER: 'number',
  DATE: 'date',
  URL: 'url',
  TEL: 'tel',
  PASSWORD: 'password',
} as const

export type InputType = (typeof INPUT_TYPE)[keyof typeof INPUT_TYPE]

export const ROLE_DISPLAY_NAMES: Record<UserRole, string> = {
  [UserRole.admin]: 'Admin',
  [UserRole.sales]: 'Sales',
  [UserRole.candidate]: 'Candidate',
  [UserRole.campaignManager]: 'Campaign Manager',
  [UserRole.demo]: 'Demo',
}

/**
 * Form section titles
 */
export const USER_FORM_SECTIONS = {
  BASIC_INFO: 'Basic Information',
  ROLES: 'Roles',
  USER_SETTINGS: 'User Settings',
} as const

export const CAMPAIGN_FORM_SECTIONS = {
  STATUS: 'Campaign Status',
  TIER: 'Election Results (Campaign Tier)',
  DATA: 'Campaign Data',
  LOCATION: 'Location',
  OFFICE: 'Office',
  ELECTION: 'Election',
  FILING_PERIOD: 'Filing Period',
  PARTY: 'Party',
  BACKGROUND: 'Background',
} as const

export const P2V_FORM_SECTIONS = {
  STATUS: 'P2V Status',
  TARGET_NUMBERS: 'Target Numbers',
  PARTY_DEMOGRAPHICS: 'Demographics - Party Affiliation',
  GENDER_DEMOGRAPHICS: 'Demographics - Gender',
  RACE_DEMOGRAPHICS: 'Demographics - Race/Ethnicity',
  VIABILITY: 'Viability Analysis',
} as const

export const ELECTED_OFFICE_FORM_SECTIONS = {
  TERM_INFO: 'Term Information',
  STATUS: 'Status',
} as const

/**
 * Sentinel value for "no selection" in Radix UI Select components.
 * Radix Select requires non-empty string values, so we use this
 * to represent null/undefined selections.
 */
export const SELECT_NONE_VALUE = '__none__'

/**
 * Message shown to user when they try to navigate away with unsaved changes
 */
export const UNSAVED_CHANGES_MESSAGE =
  'You have unsaved changes. Are you sure you want to leave this page?'
