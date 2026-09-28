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
  title,
  message,
  action,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Card>, 'children' | 'title'> & {
  // A heading over the sentence. Optional, and worth adding only where the
  // sentence alone would be read as a caption on the surface rather than
  // as the whole of what is there — a panel that has room for it, not a
  // one-line row in a table.
  title?: React.ReactNode
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
      {/* Tighter than the card's own `gap-4`: a title and the sentence it
          heads are one block, and the CTA is the thing that sits apart
          from them. With no title this renders exactly as the single
          paragraph did. */}
      <div className="flex flex-col gap-1">
        {title && (
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
        )}
        <p>{message}</p>
      </div>
      {action}
    </Card>
  )
}

export { EmptyState }
