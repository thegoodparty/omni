'use client'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@styleguide'
import { LoaderCircleIcon } from '@styleguide/components/ui/icons'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  /**
   * When true, the confirm button shows a spinner and is disabled, the
   * cancel button is disabled, and outside-click / Escape dismissal is
   * blocked. Use while an in-flight delete is pending so the user can't
   * close the dialog before the mutation resolves.
   */
  confirming?: boolean
  /**
   * Optional inline error rendered below the description. Used to surface
   * a failed delete attempt without closing the dialog so the user can
   * retry.
   */
  errorMessage?: string | null
}

/**
 * Shared confirm-delete dialog. Thin wrapper around the styleguide AlertDialog
 * primitive so per-surface confirm-with-inline-error flows stay declarative
 * without duplicating header/footer markup. Bumps z-index above a host Drawer
 * (z-50) so the dialog stacks correctly when opened from inside one.
 */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  confirming = false,
  errorMessage = null,
}: Props) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && confirming) return
        onOpenChange(next)
      }}
    >
      <AlertDialogContent className="z-[2000]">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {errorMessage ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {errorMessage}
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={confirming}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
            disabled={confirming}
            data-loading={confirming}
          >
            {confirming ? (
              <LoaderCircleIcon className="size-4 animate-spin" aria-hidden />
            ) : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
