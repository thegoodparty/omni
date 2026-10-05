import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getFlagVariants } from '@shared/experiments/getFlagVariants'
import { SERVE_PRIORITIES_FLAG_KEY } from '@shared/experiments/servePrioritiesFlag'

export const dynamic = 'force-dynamic'

// Gated at the segment so the list and every priority under it are covered by
// one branch, and server-side so a flag-off user never reaches the priorities
// or community-issues reads below. Anonymous, unresolvable and unassigned all
// read off, which is the state everyone outside the rollout is in.
export default async function PrioritiesLayout({
  children,
}: {
  children: ReactNode
}): Promise<React.JSX.Element> {
  const variants = await getFlagVariants()
  if (variants?.[SERVE_PRIORITIES_FLAG_KEY]?.value !== 'on') {
    redirect('/chief-of-staff')
  }
  return <>{children}</>
}
