import { FetchError } from 'ofetch'
import { extractApiErrorInfo } from 'helpers/extractApiErrorInfo'

// Shared with the outreach drawer's Assignees section (ENG-11056), which
// reads the same team roster to build its assign picker — pulled out so the
// role vocabulary and query key aren't redefined per caller.

// Only 'owner' and 'campaignAdmin' can appear on a membership row today, and
// 'volunteer' only on a pending invite or an accepted list-scoped invitee
// (ENG-11049) — kept here anyway so an unmapped role never renders as a raw
// enum value.
export const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  campaignAdmin: 'Campaign Manager',
  volunteer: 'Volunteer',
}

// Locked copy (ENG-11058 design): the invite drawer's role-selection cards
// and the team page's "How roles work" card must read identically, so both
// read this one record rather than restating the sentences.
export const ROLE_DESCRIPTIONS: Record<'campaignAdmin' | 'volunteer', string> =
  {
    campaignAdmin:
      'Runs everything on the campaign except billing and account settings.',
    volunteer: 'Runs door knocking or phone banking outreach campaigns only.',
  }

export const teamQueryKey = (orgSlug: string | undefined) => ['team', orgSlug]

export const formatName = (name: string | null, email: string): string =>
  name && name.trim().length > 0 ? name : email

const INVITE_ERROR_FALLBACK =
  'Something went wrong sending the invite. Please try again.'

// Shared by InviteMemberDialog (the outreach drawer's list-scoped entry
// point) and InviteMemberDrawer (the team page's two-step drawer, ENG-11058)
// — both hit the same 409 (already a member / already pending) on the same
// endpoint, and gp-api's own message reads better than a generic one.
export const toInviteErrorMessage = (error: unknown): string =>
  (error instanceof FetchError &&
    error.status === 409 &&
    extractApiErrorInfo(error.data).message) ||
  INVITE_ERROR_FALLBACK
