'use client'

import { use } from 'react'
import { useCampaign } from '@shared/hooks/useCampaign'
import { DoorKnockingFlow } from 'app/dashboard/outreach/v2/door-knocking/DoorKnockingFlow'
import { parsePositiveListId } from 'app/dashboard/outreach/util/parsePositiveListId.util'
import type { Campaign } from 'helpers/types'

// Intercepts navigation to /dashboard/door-knocking from within the outreach
// segment (tile click, "Continue knocking" CTA). Renders the surface as a
// modal over the hub via the @dk parallel slot. Direct URL visits and
// full-page reloads bypass this intercept and fall through to
// app/dashboard/door-knocking/page.tsx.
//
// Client Component so the modal appears instantly on click — a Server
// Component here would pay a network round trip for `fetchUserCampaign()`
// before anything rendered. The hub above already loads campaign into
// CampaignContext so we can read it synchronously.
interface PageParams {
  searchParams: Promise<{
    listId?: string
    walkTurfId?: string
    outreachId?: string
    create?: string
  }>
}

export default function InterceptedDoorKnockingPage({
  searchParams,
}: PageParams): React.JSX.Element {
  const { listId, walkTurfId, outreachId, create } = use(searchParams)
  const [campaign] = useCampaign()

  return (
    <DoorKnockingFlow
      campaign={(campaign as Campaign) ?? null}
      preselectedListId={parsePositiveListId(listId)}
      walkTurfId={parsePositiveListId(walkTurfId)}
      fromOutreachId={parsePositiveListId(outreachId)}
      openCreateFlow={create === '1'}
    />
  )
}
