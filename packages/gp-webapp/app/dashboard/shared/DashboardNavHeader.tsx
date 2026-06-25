import type { LucideIcon } from 'lucide-react'

// Full-bleed page header (icon + tab name) that mirrors the active sidebar nav
// item. Rendered by DashboardLayout above the padded content wrapper so it sits
// flush against the layout edges, matching the Serve nav prototype.
const DashboardNavHeader = ({
  icon: Icon,
  label,
}: {
  icon: LucideIcon
  label: string
}): React.JSX.Element => (
  <div className="flex items-center gap-2 border-b border-border bg-background px-6 py-4">
    <Icon className="size-5 text-foreground" aria-hidden />
    <span className="text-base font-semibold text-foreground">{label}</span>
  </div>
)

export default DashboardNavHeader
