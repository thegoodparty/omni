import {
  ClipboardListIcon,
  FlagIcon,
  SendIcon,
  SparklesIcon,
  SwordsIcon,
  UsersRoundIcon,
} from '@styleguide/components/ui/icons'

// Keyed by a serializable string rather than taking the icon component itself:
// the Serve pages that set navHeader (chief-of-staff, briefings) are Server
// Components, and a function/component prop can't cross the RSC boundary into
// the client DashboardLayout. A string key can.
const NAV_HEADER_ICONS = {
  sparkles: SparklesIcon,
  clipboard: ClipboardListIcon,
  flag: FlagIcon,
  send: SendIcon,
  users: UsersRoundIcon,
  swords: SwordsIcon,
}

export type NavHeaderIconKey = keyof typeof NAV_HEADER_ICONS

// Full-bleed page header (icon + tab name) that mirrors the active sidebar nav
// item. Rendered by DashboardLayout above the padded content wrapper so it sits
// flush against the layout edges, matching the Serve nav prototype.
const DashboardNavHeader = ({
  icon,
  label,
}: {
  icon: NavHeaderIconKey
  label: string
}): React.JSX.Element => {
  const Icon = NAV_HEADER_ICONS[icon]
  return (
    <div className="flex items-center gap-2 border-b border-border bg-background px-6 py-4">
      <Icon className="size-5 text-foreground" aria-hidden />
      <h1 className="text-base font-semibold text-foreground">{label}</h1>
    </div>
  )
}

export default DashboardNavHeader
