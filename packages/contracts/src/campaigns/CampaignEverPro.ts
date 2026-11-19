/**
 * Whether a campaign was ever on Pro. The win-to-Serve handoff keys on this,
 * not on Pro now, so gp-api's office list and the webapp's result page agree.
 */
// Many winners cancel Pro after election day, and a downgrade leaves
// isProUpdatedAt and subscriptionCanceledAt behind, so either one marks a
// campaign that was Pro once. A cancelled subscriptionId is JSON null.
export const campaignWasEverPro = (campaign: {
  isPro?: boolean | null
  details?: {
    isProUpdatedAt?: string | number | null
    subscriptionId?: string | null
    subscriptionCanceledAt?: number | null
  } | null
}): boolean =>
  Boolean(campaign.isPro) ||
  campaign.details?.isProUpdatedAt != null ||
  campaign.details?.subscriptionId != null ||
  campaign.details?.subscriptionCanceledAt != null
