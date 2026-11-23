import type { TeamResponse } from '@goodparty_org/contracts'
import { usePlan } from 'app/dashboard/shared/membership/deriveMembershipState'

export const UNAVAILABLE_COPY = {
  TEST_ORGANIZATION: 'Team invites aren’t available for test accounts.',
  ELECTED_OFFICE: 'Team accounts aren’t available for elected offices yet.',
} as const

// gp-api computes the gate (GET team `invites`) with the same code POST
// team/invites enforces, keyed on the owner's flag, so nothing is re-derived
// here. While the team query is loading there is no gate to show.
export const useTeamInviteGate = (
  invites: TeamResponse['invites'] | undefined,
): {
  gated: boolean
  plan: string
  unavailableReason: keyof typeof UNAVAILABLE_COPY | null
} => {
  const { plan } = usePlan()
  const reason = invites?.reason ?? null
  return {
    gated: reason === 'TEAM_PLAN_REQUIRED',
    plan,
    unavailableReason: reason === 'TEAM_PLAN_REQUIRED' ? null : reason,
  }
}
