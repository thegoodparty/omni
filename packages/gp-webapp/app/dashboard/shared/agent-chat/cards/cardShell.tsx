import type { ReactNode } from 'react'
import { Card, Skeleton, cn } from '@styleguide'

export const SERVE_CARD_SHELL_COPY = {
  unavailable: 'Could not load this. Refresh to try again.',
}

/**
 * Cards sit inline in a conversation, so the shell is deliberately quieter
 * than a dashboard card: no header band, no heavy elevation.
 */
export const CardShell = ({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) => (
  <Card className={cn('w-full gap-0 rounded-2xl p-4 shadow-xs', className)}>
    {children}
  </Card>
)

export const CardNote = ({ children }: { children: ReactNode }) => (
  <p className="text-muted-foreground text-[13px]">{children}</p>
)

export const CardLoading = ({ rows = 2 }: { rows?: number }) => (
  <CardShell>
    <div className="flex flex-col gap-3" data-testid="chat-card-loading">
      <Skeleton className="h-4 w-32" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  </CardShell>
)

export const CardUnavailable = () => (
  <CardShell>
    <CardNote>{SERVE_CARD_SHELL_COPY.unavailable}</CardNote>
  </CardShell>
)
