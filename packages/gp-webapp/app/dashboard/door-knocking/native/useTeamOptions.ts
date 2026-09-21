import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clientRequest } from 'gpApi/typed-request'
import { formatName, teamQueryKey } from 'app/dashboard/team/team.util'

// One canvasser the campaign could hand a turf to.
export interface TeamOption {
  userId: number
  label: string
}

// The org's roster, in the one shape door knocking wants it: an id and a name
// to show. Two surfaces read it — the drawing surface's panel, which assigns a
// turf, and the draw step's cards, which name who is already assigned — and
// they are never on screen together, so a hook rather than a prop keeps the
// page from threading a roster through a seam that has no other use for it.
//
// Shares `teamQueryKey` with the team page and the outreach drawer's assignees
// section, which is the whole reason it is read through that helper: four
// surfaces asking one question must not each keep their own copy of the
// answer, and a candidate arriving from any of the others pays for no request.
//
// Failure is silent on purpose. An assignee is optional on every turf and can
// be set from the outreach drawer afterwards, so a roster that will not load
// costs a convenience and not the campaign — the panel hides the control
// rather than offering an empty menu.
export const useTeamOptions = (orgSlug: string | undefined): TeamOption[] => {
  const teamQuery = useQuery({
    queryKey: teamQueryKey(orgSlug),
    queryFn: () =>
      clientRequest('GET /v1/organizations/team', {}).then((res) => res.data),
    enabled: !!orgSlug,
  })
  return useMemo(
    () =>
      (teamQuery.data?.members ?? []).map((member) => ({
        userId: member.userId,
        label: formatName(member.name, member.email),
      })),
    [teamQuery.data],
  )
}
