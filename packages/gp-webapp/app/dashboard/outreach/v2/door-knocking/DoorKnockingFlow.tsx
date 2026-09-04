'use client'

import NativeDoorKnockingPage from 'app/dashboard/door-knocking/native/NativeDoorKnockingPage'
import { Campaign } from 'helpers/types'

interface DoorKnockingFlowProps {
  campaign: Campaign | null
  preselectedListId?: number
  walkTurfId?: number
  fromOutreachId?: number
  openCreateFlow?: boolean
}

// Modal wrapper for the intercepting-route @dk slot. Deliberately NOT a
// vaul Drawer: the create flow's own OutreachFlowShell is a vaul Drawer,
// and nesting two vaul portals produces two independent slide animations.
// A transparent fixed-inset container lets the inner shell provide the
// (single) slide-in over the visible hub — matching how the other
// channels' flows enter and exit.
//
// standalone=false on the surface skips its DashboardLayout wrap, which
// would otherwise paint an opaque background over the hub.
export const DoorKnockingFlow = ({
  campaign,
  preselectedListId,
  walkTurfId,
  fromOutreachId,
  openCreateFlow,
}: DoorKnockingFlowProps) => (
  // Transparent container — no bg. The create flow's OutreachFlowShell is
  // a vaul Drawer that portals to body with its own overlay, so the hub
  // stays visible behind (dimmed by the drawer's overlay) as the drawer
  // slides up, matching how the other channel flows enter. When the walk
  // or draw step needs a full-screen map, the map canvas itself is opaque
  // and fills this container.
  <div className="fixed inset-0 z-40 flex flex-col">
    <NativeDoorKnockingPage
      pathname="/dashboard/outreach"
      campaign={campaign}
      preselectedListId={preselectedListId}
      walkTurfId={walkTurfId}
      fromOutreachId={fromOutreachId}
      openCreateFlow={openCreateFlow}
      standalone={false}
    />
  </div>
)
