import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { isActiveOrgVolunteer } from '@shared/organizations/activeOrgVolunteer.server'
import VolunteerSidebar from './VolunteerSidebar'

export const dynamic = 'force-dynamic'

/**
 * Volunteer route group (ENG-11052, Phase 1.5 of the Team accounts TDD): a
 * volunteer gets this reductive shell instead of the campaign dashboard,
 * which assumes a campaign (nav, campaign fetches, tracker widgets). A
 * left sidebar (logo/wordmark, a user block that switches between campaigns,
 * logout) plus a slim content-area top bar naming the active campaign
 * (ENG-11068, the Lovable design's own sidebar shape) — no left rail shared
 * with the dashboard, and no `fetchCampaignStatus`/`candidateAccess`
 * dependency, since neither applies to a volunteer.
 *
 * Gated on win-team-accounts AND the viewer's ACTIVE org role: real
 * volunteer memberships aren't creatable yet, so this is a pure safety net
 * today, but it's what keeps a typed /volunteer URL from ever rendering this
 * shell for an owner/manager, or from existing at all with the flag off.
 */
export default async function VolunteerLayout({
  children,
}: {
  children: ReactNode
}): Promise<React.JSX.Element> {
  if (!(await isActiveOrgVolunteer())) {
    redirect('/dashboard')
  }

  return <VolunteerSidebar>{children}</VolunteerSidebar>
}
