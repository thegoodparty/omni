// No 'use client' directive: every importer is already a client component
// (DashboardLayout for the context, and each page's own client component for
// the action), so this module is always pulled into the client graph through
// one of them. The RSC page shells only pass the serializable navHeader prop
// and never touch this file.
import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Set by DashboardLayout to the CTA slot inside the DashboardNavHeader it
// renders (null until that element mounts, and on pages with no navHeader).
export const NavHeaderActionSlotContext = createContext<HTMLElement | null>(
  null,
)

// Puts a page's primary action in its title bar, aligned top right. The bar is
// rendered by DashboardLayout, but every page whose bar carries a CTA owns that
// CTA's state far deeper in the tree — and race-opponent / public-profile are
// Server Components, so the node can't ride the serializable navHeader prop.
// Portalling up into a slot the bar exposes keeps one title-bar component for
// every page instead of each page rebuilding the bar around its own button.
//
// With no slot in context the action renders in place, so a page that doesn't
// set navHeader still shows its CTA and a component test can render the owning
// component without the layout around it.
const DashboardNavHeaderAction = ({
  children,
}: {
  children: ReactNode
}): React.JSX.Element => {
  const slot = useContext(NavHeaderActionSlotContext)
  return slot ? createPortal(children, slot) : <>{children}</>
}

export default DashboardNavHeaderAction
