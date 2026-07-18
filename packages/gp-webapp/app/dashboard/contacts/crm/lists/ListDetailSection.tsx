// Lovable list-detail primitives (ENG-10725 follow-up): 12px uppercase
// primary-colored micro-labels, and bordered stat-tile cards with a leading
// icon, shared by the demographics, reachability, and filter-summary
// sections of ListDetailSheet so the three can't drift.

export const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-xs font-semibold uppercase tracking-wide text-primary">
    {children}
  </h3>
)

export const StatTile = ({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode
  label: string
  value: string
}) => (
  <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
    <dt className="flex items-center gap-2 text-sm">
      {icon}
      {label}
    </dt>
    <dd className="text-sm font-semibold">{value}</dd>
  </div>
)
