// Shared client types for the in-product public-profile editor (Serve + Win).
// These mirror the gp-api `PersonProfile` overlay + owner endpoints
// (packages/gp-api/src/personProfiles). The overlay is the product source of
// truth for everything a user authors/publishes; the marketing /people page
// composes it over the read-only election-api civics spine at render.

export type PersonProfileIssueStatus =
  | 'IN_PROGRESS'
  | 'PRIORITIZED'
  | 'ONGOING'
  | 'RESOLVED'

export interface PersonProfileAccomplishment {
  title: string
  description?: string | null
  date?: string | null
}

export interface PersonProfileRecentExperienceItem {
  title: string
  organization?: string | null
  term?: string | null
  // Whether this row was auto-seeded from BallotReady or authored in-product.
  source?: 'ballotready' | 'user' | null
}

export interface PersonProfileIssueOverlay {
  issueId: string
  visible: boolean
  status: PersonProfileIssueStatus | null
  transparency: string | null
  sortOrder: number | null
  // Flattened from the linked Serve Priority the owner chose to surface.
  priority?: { title: string; description: string }
}

export interface PersonProfile {
  id: string
  personId: string
  userId: number
  publishedAt: string | null
  deletedAt: string | null
  displayName: string | null
  roleTitleOverride: string | null
  bioOverride: string | null
  coverImageUrl: string | null
  avatarUrl: string | null
  whyRunning: string | null
  accomplishments: PersonProfileAccomplishment[] | null
  recentExperience: PersonProfileRecentExperienceItem[] | null
  publicEmail: string | null
  publicPhone: string | null
  officePhone: string | null
  websiteUrl: string | null
  governmentWebsiteUrl: string | null
  instagramUrl: string | null
  tiktokUrl: string | null
  facebookUrl: string | null
  twitterUrl: string | null
  linkedinUrl: string | null
  defaultTransparency: string | null
  issues: PersonProfileIssueOverlay[]
  createdAt: string
  updatedAt: string
}

// Every field is optional/nullable; the endpoint merges only what is sent.
export interface UpsertPersonProfileRequest {
  displayName?: string | null
  roleTitleOverride?: string | null
  bioOverride?: string | null
  coverImageUrl?: string | null
  avatarUrl?: string | null
  whyRunning?: string | null
  accomplishments?: PersonProfileAccomplishment[] | null
  recentExperience?: PersonProfileRecentExperienceItem[] | null
  publicEmail?: string | null
  publicPhone?: string | null
  officePhone?: string | null
  websiteUrl?: string | null
  governmentWebsiteUrl?: string | null
  instagramUrl?: string | null
  tiktokUrl?: string | null
  facebookUrl?: string | null
  twitterUrl?: string | null
  linkedinUrl?: string | null
  defaultTransparency?: string | null
}

export interface SetProfileIssuesRequest {
  issues: Array<{
    issueId: string
    visible?: boolean
    status?: PersonProfileIssueStatus | null
    transparency?: string | null
    sortOrder?: number | null
  }>
}

export interface GetMinePersonProfileResponse {
  profile: PersonProfile | null
  canCreate: boolean
}
