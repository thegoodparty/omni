import {
  USER_ROLE_VALUES,
  type UserRole as UserRoleType,
  WHY_BROWSING_VALUES,
  type WhyBrowsing as WhyBrowsingType,
  CAMPAIGN_TIER_VALUES,
  type CampaignTier as CampaignTierType,
} from '@goodparty_org/contracts'

type EnumObject<T extends readonly string[]> = { [K in T[number]]: K }

const toEnumObject = <T extends readonly string[]>(values: T): EnumObject<T> =>
  Object.fromEntries(values.map((v) => [v, v])) as EnumObject<T>

export type UserRole = UserRoleType
export const UserRole = toEnumObject(USER_ROLE_VALUES)

export type WhyBrowsing = WhyBrowsingType
export const WhyBrowsing = toEnumObject(WHY_BROWSING_VALUES)

export type CampaignTier = CampaignTierType
export const CampaignTier = toEnumObject(CAMPAIGN_TIER_VALUES)
