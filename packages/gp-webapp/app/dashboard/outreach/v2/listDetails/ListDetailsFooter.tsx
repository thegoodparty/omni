import Link from 'next/link'
import type { ReactNode } from 'react'
import { Button } from '@styleguide'
import { AUTOMATIC_NOTE, type ListDetailsFooterMode } from './footerMode'

// A footer action is described rather than passed as a node, because the shape
// of the row — which control is compact and which one takes the width — is the
// part that has to be identical across the two drawers. The destructive slot
// stays a node: door knocking's Delete is `DeleteTurfControl` (mutation,
// confirm dialog and 409 handling in one component) and the outreach drawer's
// opens its own AlertDialog, so there is nothing shared to describe there.
export type ListDetailsFooterAction =
  | { kind: 'link'; label: string; href: string; icon?: ReactNode }
  | {
      kind: 'button'
      label: string
      icon?: ReactNode
      onClick: () => void
      disabled?: boolean
    }
  | { kind: 'disabled'; label: string; icon?: ReactNode }

interface ListDetailsFooterProps {
  mode: ListDetailsFooterMode
  // Compact, ghost, destructive — first in the row, never the width-taker.
  destructive?: ReactNode
  primary?: ListDetailsFooterAction | null
  // A second full-width row under the primary one. Archive/restore lives here:
  // it is ours rather than the canvas's, and pairing it beside the canvas's own
  // CTA would put three controls in a row built for two.
  secondary?: ReactNode
  // One muted line under the actions, for a surface that has to explain an
  // action it deliberately does not offer.
  note?: ReactNode
}

const PrimaryAction = ({ action }: { action: ListDetailsFooterAction }) => {
  if (action.kind === 'link') {
    return (
      <Button asChild className="flex-1">
        <Link href={action.href}>
          {action.icon}
          {action.label}
        </Link>
      </Button>
    )
  }
  return (
    <Button
      className="flex-1"
      disabled={action.kind === 'disabled' || action.disabled}
      onClick={action.kind === 'button' ? action.onClick : undefined}
    >
      {action.icon}
      {action.label}
    </Button>
  )
}

export const ListDetailsFooter = ({
  mode,
  destructive,
  primary,
  secondary,
  note,
}: ListDetailsFooterProps) => {
  if (mode === 'none') return null
  const hasActions = Boolean(destructive || primary || secondary)
  if (mode !== 'automatic' && !hasActions && !note) return null

  return (
    <div className="shrink-0 border-t border-border bg-background px-4 py-4 lg:px-6">
      <div className="mx-auto flex w-full max-w-[608px] flex-col gap-3">
        {mode === 'automatic' ? (
          <p className="flex-1 text-center text-sm text-muted-foreground">
            {AUTOMATIC_NOTE}
          </p>
        ) : (
          (destructive || primary) && (
            <div className="flex gap-3">
              {destructive}
              {primary && <PrimaryAction action={primary} />}
            </div>
          )
        )}
        {secondary}
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
    </div>
  )
}
