import { cn } from '@styleguide'
import { NAV_HEADER_ICONS, type NavHeaderIconKey } from './navLabels'

// Full-bleed page title bar (icon + tab name) that mirrors the active sidebar
// nav item — the Voter Data page's bar is the reference every other main nav
// page copies. Rendered by DashboardLayout above the padded content wrapper so
// it sits flush against the layout edges.
//
// Height is fixed at h-14 (the 56px the icon + title already came to at py-4)
// so a page whose bar carries a CTA reads at exactly the same height as one
// that doesn't — the CTA scales to fit the bar, the bar never grows around it.
//
// Desktop only by default: on mobile the title lives in the top bar
// (MobileMenuTrigger), so rendering it here too would show it twice. A bar with
// a CTA does stay on mobile, as an action-only strip (title hidden, CTA shown)
// — the CTA has nowhere else to go.
const DashboardNavHeader = ({
  icon,
  label,
  centered = false,
  hasAction = false,
  actionSlotRef,
}: {
  icon: NavHeaderIconKey
  label: string
  centered?: boolean
  hasAction?: boolean
  actionSlotRef?: (node: HTMLDivElement | null) => void
}): React.JSX.Element => {
  const Icon = NAV_HEADER_ICONS[icon]
  return (
    <div
      className={cn(
        'h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-6',
        hasAction ? 'flex' : 'hidden lg:flex',
        centered && 'justify-center',
      )}
    >
      <div
        className={cn(
          'items-center gap-2',
          hasAction ? 'hidden lg:flex' : 'flex',
        )}
      >
        <Icon className="size-5 text-foreground" aria-hidden />
        <h1 className="text-base font-semibold text-foreground">{label}</h1>
      </div>
      {/* DashboardNavHeaderAction portals a page's primary action in here, so
          every page's title bar stays this one component. */}
      <div
        ref={actionSlotRef}
        data-slot="nav-header-action"
        className="ml-auto flex items-center gap-3"
      />
    </div>
  )
}

export default DashboardNavHeader
