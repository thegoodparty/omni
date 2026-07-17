// Lovable list-detail primitives (ENG-10725): 12px uppercase muted
// micro-labels over unboxed content, and compact borderless dt/dd stat
// tiles, shared by the demographics, reachability, and filter-summary
// sections of ListDetailSheet so the three can't drift.

export const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
    {children}
  </h3>
)

export const StatTile = ({
  label,
  value,
}: {
  label: string
  value: string
}) => (
  <div className="flex flex-col gap-0.5">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="text-sm font-semibold">{value}</dd>
  </div>
)
