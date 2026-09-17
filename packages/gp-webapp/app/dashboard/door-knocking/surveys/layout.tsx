import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getFlagVariants } from '@shared/experiments/getFlagVariants'
import { NATIVE_DOOR_KNOCKING_FLAG_KEY } from '@shared/experiments/nativeDoorKnockingFlag'

export const dynamic = 'force-dynamic'

// The designer under this route is the eCanvasser-era one: its questions are
// written to eCanvasser and are never asked at a native knock, which logs
// through RecordKnockForm into the CRM's own tables. The native flow ships its
// own script (DoorScript, built from the candidate's saved issues), so a pilot
// user who reaches this by URL — or from the Door Knocking Scripts tab — meets
// a second, competing script surface and can spend an afternoon authoring
// questions that go nowhere.
//
// Gated at the segment rather than per page so /surveys and /surveys/:id (and
// anything added under them) are covered by one branch. Server-side because
// the flag resolves server-side for the SSR seed anyway: a flag-on user is
// redirected before the eCanvasser reads in the pages below ever run.
//
// Control is untouched — flag off, unassigned, or unresolvable renders the
// legacy designer exactly as before, tabs and all. That is still the
// production experience for everyone outside the pilot.
export default async function DoorKnockingSurveysLayout({
  children,
}: {
  children: ReactNode
}): Promise<React.JSX.Element> {
  const variants = await getFlagVariants()
  if (variants?.[NATIVE_DOOR_KNOCKING_FLAG_KEY]?.value === 'on') {
    redirect('/dashboard/door-knocking')
  }
  return <>{children}</>
}
