import type * as React from 'react'
import { Card } from './card'
import { cn } from '../../lib/utils'

// The one empty state, so a surface with nothing on it does not have to
// invent how to say so. It is the pattern the outreach history table
// already used — a Card holding one centred, muted sentence — with the CTA
// that was always meant to sit under it made part of the component rather
// than left to each caller.
//
// Copy follows docs/product-copy.md rule 8: what is here (or is not), then
// what to do about it, in that order. The sentence is one line of twenty
// words or fewer; anything longer is explaining the system.
function EmptyState({
  message,
  action,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Card>, 'children'> & {
  message: React.ReactNode
  // The one thing to do about it. Optional, because plenty of empty states
  // are a statement rather than an invitation — an archive with nothing in
  // it has no button that would help.
  action?: React.ReactNode
}) {
  return (
    <Card
      data-slot="empty-state"
      className={cn(
        'w-full items-center gap-4 p-6 text-center text-sm text-muted-foreground',
        className,
      )}
      {...props}
    >
      <p>{message}</p>
      {action}
    </Card>
  )
}

export { EmptyState }
