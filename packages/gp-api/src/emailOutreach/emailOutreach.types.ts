export type EmailSendScope = {
  organizationSlug: string
  campaignId: number | null
  // Whose unsubscribes this send honors: the organization's own, plus the
  // campaign's when an office sends.
  suppressionSlugs: string[]
  senderName: string
  fallbackName: string
  forwardToCandidates: (string | null | undefined)[]
  paidForBy: string | null
}
