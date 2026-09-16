'use client'

import { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import Paper from './Paper'
import H5 from '../typography/H5'

interface ResponsiveModalProps {
  open: boolean
  onClose?: () => void
  title?: string
  children: ReactNode
  preventBackdropClose?: boolean
  preventEscClose?: boolean
  hideClose?: boolean
  fullSize?: boolean
  theme?: {
    bg?: string
    text?: string
    border?: string
  }
}

// Radix Dialog underneath. On mobile the panel docks to the bottom edge
// (bottom-sheet); on lg+ it centers. Radix owns focus trap, Escape, and
// outside-click; preventBackdropClose / preventEscClose ride Radix's own
// onInteractOutside / onEscapeKeyDown events.
export default function ResponsiveModal({
  open,
  onClose,
  title,
  children,
  preventBackdropClose = false,
  preventEscClose = false,
  hideClose = false,
  fullSize = false,
  theme,
}: ResponsiveModalProps) {
  const positionClasses = fullSize
    ? 'inset-0 max-h-screen max-w-full rounded-none'
    : 'inset-x-0 bottom-0 max-h-[90vh] rounded-b-none lg:inset-auto lg:bottom-auto lg:top-1/2 lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:min-w-[600px] lg:max-w-[90vw] lg:rounded-b-xl'

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose?.()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 transition-opacity data-[state=closed]:opacity-0 data-[state=open]:opacity-100" />
        <Dialog.Content
          onInteractOutside={(event) => {
            if (preventBackdropClose) event.preventDefault()
          }}
          onEscapeKeyDown={(event) => {
            if (preventEscClose) event.preventDefault()
          }}
          onOpenAutoFocus={(event) => {
            // Modals hold long-form policy text (SmsTermsModal /
            // PrivacyPolicyModal) — don't auto-focus the first interactive
            // node, since it can be well below the fold.
            event.preventDefault()
          }}
          className={`fixed z-50 flex flex-col outline-none ${positionClasses}`}
        >
          <Paper
            className={`
              relative flex h-full flex-col
              !px-4 !pt-16 !pb-8 lg:!px-8 xl:!p-16
              ${fullSize ? '!rounded-none' : '!rounded-b-none lg:!rounded-b-xl'}
            `}
            theme={theme}
          >
            {title ? (
              <Dialog.Title asChild>
                <H5 className="absolute top-6 left-4 lg:left-8 xl:left-16">
                  {title}
                </H5>
              </Dialog.Title>
            ) : (
              // Radix requires a Title for a11y; render a hidden one when the
              // caller doesn't supply one visibly.
              <Dialog.Title className="sr-only">Dialog</Dialog.Title>
            )}
            {/* Description is optional but Radix logs a dev warning when
                missing — a bare sr-only line silences it. */}
            <Dialog.Description className="sr-only">
              {title || 'Dialog content'}
            </Dialog.Description>
            {!hideClose ? (
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Close"
                  className="absolute top-6 right-4 cursor-pointer rounded p-1 outline-none hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </Dialog.Close>
            ) : null}

            <div className="flex-1 overflow-auto">{children}</div>
          </Paper>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
