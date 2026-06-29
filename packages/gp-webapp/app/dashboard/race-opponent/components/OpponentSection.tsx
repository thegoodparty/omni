'use client'

import { useState } from 'react'
import {
  Card,
  cn,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@styleguide'
import { ChevronDownIcon } from '@styleguide/components/ui/icons'

type Props = {
  title: string
  icon?: React.ReactNode
  meta?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}

const OpponentSection = ({
  title,
  icon,
  meta,
  defaultOpen = true,
  children,
}: Props): React.JSX.Element => {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]">
          <span className="flex items-center gap-2 text-base font-semibold text-foreground">
            {icon && (
              <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                {icon}
              </span>
            )}
            {title}
          </span>
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            {meta}
            <ChevronDownIcon
              className={cn(
                'size-4 shrink-0 transition-transform',
                open && 'rotate-180',
              )}
              aria-hidden
            />
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-border px-6 py-4">
          {children}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

export default OpponentSection
