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
            {/* Prototype header anatomy: desktop back floats left of the
                608px column; mobile keeps a fixed icon slot so the title
                doesn't shift between steps. */}
            <div className="relative flex items-center gap-2 lg:block">
              {onBack && (
                <div className="absolute top-1/2 right-full mr-9 hidden -translate-y-1/2 lg:block">
                  <Button
                    type="button"
                    variant="outline"
                    size="small"
                    onClick={onBack}
                  >
                    <ArrowLeftIcon className="size-4" aria-hidden />
                    Back
                  </Button>
                </div>
              )}
              <div className="size-8 shrink-0 lg:hidden">
                {onBack && (
                  <IconButton
                    type="button"
                    variant="outline"
                    size="small"
                    aria-label="Back"
                    onClick={onBack}
                  >
                    <ArrowLeftIcon className="size-4" />
                  </IconButton>
                )}
              </div>
              <DrawerTitle className="min-w-0 flex-1 truncate pr-8 text-base font-semibold lg:pr-0">
                {title}
              </DrawerTitle>
            </div>
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
            <Button
              type="button"
              className="w-full text-sm"
              onClick={cta.onClick}
              disabled={cta.disabled}
              loading={cta.loading}
            >
              {cta.label}
            </Button>
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
