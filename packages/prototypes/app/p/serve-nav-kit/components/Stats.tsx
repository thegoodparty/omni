'use client'

import { Card, Separator } from '@goodparty_org/styleguide'

type Stat = { label: string; value: string }

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
