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
  DrawerTitle,
  IconButton,
  Stepper,
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
            {/* Prototype full-mode header anatomy: no visible title, no close
                here (the sheet's absolute corner X is the close). One Back
                button, responsive: pinned to the panel's top-left corner on
                mobile (the header's 64px top padding clears that strip),
                sitting in an always-reserved row above the stepper on
                desktop — one element so jsdom/a11y see a single Back. */}
            <div className="flex h-0 items-center lg:mb-4 lg:h-10">
              {onBack && (
                <IconButton
                  type="button"
                  variant="outline"
                  aria-label="Back"
                  onClick={onBack}
                  className="absolute top-4 left-4 z-30 border-border text-foreground lg:static"
                >
                  <ArrowLeftIcon className="size-4" />
                </IconButton>
              )}
            </div>
            <DrawerTitle className="sr-only">{title}</DrawerTitle>
            {totalSteps > 0 && (
              <Stepper
                variant="bar"
                currentStep={currentStep}
                totalSteps={totalSteps}
                labelClassName="text-xs"
              />
            )}
          </>
        }
        footer={
          cta ? (
            // Prototype footer stacking: primary on top on mobile (column),
            // primary on the right on desktop (row-reverse).
            <div className="flex w-full flex-col gap-3 lg:flex-row-reverse lg:items-center">
              <Button
                type="button"
                className="w-full text-sm lg:w-auto lg:flex-1"
                onClick={cta.onClick}
                disabled={cta.disabled}
                loading={cta.loading}
              >
                {cta.label}
              </Button>
              {cta.secondary && (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-sm lg:w-auto lg:flex-1"
                  onClick={cta.secondary.onClick}
                >
                  {cta.secondary.label}
                </Button>
              )}
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
