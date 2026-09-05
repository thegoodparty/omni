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

export const teamQueryKey = (orgSlug: string | undefined) => ['team', orgSlug]

export const formatName = (name: string | null, email: string): string =>
  name && name.trim().length > 0 ? name : email
