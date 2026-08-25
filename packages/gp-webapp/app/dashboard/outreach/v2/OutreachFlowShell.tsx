'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  ArrowLeftIcon,
  Button,
  DrawerClose,
  DrawerTitle,
  IconButton,
  Stepper,
  XMarkIcon,
} from '@styleguide'
import { OutreachSheet } from './OutreachSheet'

export interface FlowShellCta {
  label: string
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  // Optional plain companion action rendered left of the primary (the
  // design's interstitial footer: "Later" beside "Start verification").
  secondary?: {
    label: string
    onClick: () => void
  }
}

interface OutreachFlowShellProps {
  open: boolean
  onClose: () => void
  title: string
  // 1-based; totalSteps 0 marks the success screen: the stepper hides and
  // the whole visible header is replaced (per the prototype), keeping only
  // the sr-only accessible title.
  currentStep: number
  totalSteps: number
  onBack?: () => void
  // Shell-owned, step-keyed footer CTA; null renders no footer (e.g. the
  // purpose step, where selecting a card advances the flow).
  cta: FlowShellCta | null
  // Any user input diverging from the initial state: closing asks "Discard
  // changes?"; a pristine (or completed) flow closes silently.
  dirty: boolean
  children: ReactNode
}

// The generalized channel-flow chrome (phase 1 TDD): OutreachSheet anatomy +
// sticky header with back + bar stepper, flat client flow state owned by the
// flow component, dirty-close confirm, fresh state on reopen. Step bodies
// stay dumb value/onChange components.
export const OutreachFlowShell = ({
  open,
  onClose,
  title,
  currentStep,
  totalSteps,
  onBack,
  cta,
  dirty,
  children,
}: OutreachFlowShellProps) => {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Multi-step flow: reset scroll to the top of the sheet's own scrollable
  // body (not window) on every step change (app/dashboard/CLAUDE.md
  // Navigation convention).
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [currentStep])

  const requestClose = (nextOpen: boolean) => {
    if (nextOpen) return
    // Outside-interaction dismissal is prevented at the sheet
    // (OutreachSheet's onInteractOutside), so this only sees Close /
    // Escape / drag. Still ignore any dismiss while the confirm is up —
    // reopening it from under itself is never right.
    if (confirmOpen) return
    if (dirty) {
      setConfirmOpen(true)
      return
    }
    onClose()
  }

  return (
    <>
      <OutreachSheet
        open={open}
        onOpenChange={requestClose}
        bodyRef={bodyRef}
        headerless={totalSteps === 0}
        header={
          <>
            {/* Prototype header anatomy: no visible title — a circular back
                (when the step has one) and the close sit inside the content
                column on one row, with the channel pill in the step body
                carrying the flow context. The back slot is always reserved
                so the row doesn't collapse between steps. */}
            <div className="flex items-center justify-between">
              <div className="size-10">
                {onBack && (
                  <IconButton
                    type="button"
                    variant="outline"
                    aria-label="Back"
                    onClick={onBack}
                    className="border-border text-foreground"
                  >
                    <ArrowLeftIcon className="size-4" />
                  </IconButton>
                )}
              </div>
              <DrawerClose className="inline-flex size-10 items-center justify-center rounded-full opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-primary-focus focus-visible:outline-none">
                <XMarkIcon className="size-4" />
                <span className="sr-only">Close</span>
              </DrawerClose>
            </div>
            <DrawerTitle className="sr-only">{title}</DrawerTitle>
            {totalSteps > 0 && (
              <Stepper
                variant="bar"
                currentStep={currentStep}
                totalSteps={totalSteps}
                labelClassName="text-xs"
                className="mt-2 lg:mt-3"
              />
            )}
          </>
        }
        footer={
          cta ? (
            <div className="flex w-full items-center gap-3">
              {cta.secondary && (
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1 text-sm"
                  onClick={cta.secondary.onClick}
                >
                  {cta.secondary.label}
                </Button>
              )}
              <Button
                type="button"
                className="flex-1 text-sm"
                onClick={cta.onClick}
                disabled={cta.disabled}
                loading={cta.loading}
              >
                {cta.label}
              </Button>
            </div>
          ) : undefined
        }
      >
        {children}
      </OutreachSheet>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your draft and selections will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false)
                onClose()
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
