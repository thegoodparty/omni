'use client'

import { Card, Separator } from '@goodparty_org/styleguide'

type Stat = { label: string; value: string }

// GAP: no KPI/metric tile in styleguide. Big number + label.
export const StatTile = ({ label, value }: Stat) => (
  <Card className="gap-1 p-4">
    <p className="text-foreground text-2xl font-semibold">{value}</p>
    <p className="text-muted-foreground text-xs">{label}</p>
  </Card>
)

// Composition: "label → big number" list rows in one card (Voter Universe).
export const StatRows = ({ rows }: { rows: Stat[] }) => (
  <Card className="gap-0 p-0">
    {rows.map((row, i) => (
      <div key={row.label}>
        {i > 0 && <Separator />}
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-foreground text-sm">{row.label}</span>
          <span className="text-foreground text-xl font-semibold">
            {row.value}
          </span>
        </div>
      </div>
    ))}
  </Card>
)
