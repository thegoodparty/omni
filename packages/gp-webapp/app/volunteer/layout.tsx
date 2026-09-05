import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { isActiveOrgVolunteer } from '@shared/organizations/activeOrgVolunteer.server'
import VolunteerTopBar from './VolunteerTopBar'

export const dynamic = 'force-dynamic'

/**
 * Volunteer route group (ENG-11052, Phase 1.5 of the Team accounts TDD): a
 * volunteer gets this reductive shell instead of the campaign dashboard,
 * which assumes a campaign (nav, campaign fetches, tracker widgets). Just a
 * top bar — logo, org picker, profile dropdown — no left rail and no
 * `fetchCampaignStatus`/`candidateAccess` dependency, since neither applies
 * to a volunteer.
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

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <VolunteerTopBar />
      <main className="flex-1">{children}</main>
    </div>
  )
}
