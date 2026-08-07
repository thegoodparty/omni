// No 'use client' directive: every importer is already a client component
// (DashboardLayout for the context, and each page's own client component for
// the action), so this module is always pulled into the client graph through
// one of them. The RSC page shells only pass the serializable navHeader prop
// and never touch this file.
import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { noop } from '@shared/utils/noop'

interface NavHeaderActionSlot {
  // The CTA slot element inside the rendered DashboardNavHeader — null until it
  // mounts, and on pages with no navHeader.
  element: HTMLElement | null
  // Called with +1 on mount and -1 on unmount so the bar knows whether a CTA is
  // actually present right now. A count, not a boolean: it survives a remount
  // (whose cleanup lands after the next mount) without the bar flickering.
  register: (delta: number) => void
}

// The default stands in for "no DashboardLayout above me" — a page without a
// navHeader, or a component test rendering an owner on its own.
export const NavHeaderActionSlotContext = createContext<NavHeaderActionSlot>({
  element: null,
  register: noop,
})

// Puts a page's primary action in its title bar, aligned top right. The bar is
// rendered by DashboardLayout, but every page whose bar carries a CTA owns that
// CTA's state far deeper in the tree — and race-opponent / public-profile are
// Server Components, so the node can't ride the serializable navHeader prop.
// Portalling up into a slot the bar exposes keeps one title-bar component for
// every page instead of each page rebuilding the bar around its own button.
//
// Mounting this also tells the bar a CTA exists, which is what lets the bar
// stay visible on mobile. That has to be observed rather than declared by the
// page: whether a CTA is mounted depends on page state (Know Your Opponent only
// has its Export brief in the report state, Public Profile only once a profile
// exists, Your story only once the story loads), so a page-level flag would
// leave an empty bar on mobile in every other state.
//
// With no slot in context the action renders in place, so a page that doesn't
// set navHeader still shows its CTA and a component test can render the owning
// component without the layout around it.
const DashboardNavHeaderAction = ({
  children,
}: {
  children: ReactNode
}): React.JSX.Element => {
  const { element, register } = useContext(NavHeaderActionSlotContext)

  useEffect(() => {
    register(1)
    return () => register(-1)
  }, [register])

  return element ? createPortal(children, element) : <>{children}</>
}

export default DashboardNavHeaderAction
