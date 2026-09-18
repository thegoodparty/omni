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
  Button,
  DrawerTitle,
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
    disabled?: boolean
    // `ghost` is the interstitial's dismissal. `outline` is for a pair where
    // BOTH buttons commit and the primary only claims which move is expected
    // — the door-knocking confirm step's "Save and exit" beside "Save and
    // draw another". A filled `secondary` would weight the two equally and
    // make leading with one of them say nothing.
    variant?: 'ghost' | 'outline'
  }
}

interface OutreachFlowShellProps {
  open: boolean
  onClose: () => void
  title: string
  // Left header slot — the flow's identity label (e.g. a channel badge or a
  // custom overline). Optional so callers can adopt it incrementally; when
  // omitted the header's left half is empty and the Exit button sits alone
  // on the right.
  headerBadge?: ReactNode
  // 1-based; totalSteps 0 marks the success screen: the stepper hides and
  // the whole visible header is replaced (per the prototype), keeping only
  // the sr-only accessible title.
  currentStep: number
  totalSteps: number
  onBack?: () => void
  // Shell-owned, step-keyed footer CTA; null renders no footer (e.g. the
  // purpose step, where selecting a card advances the flow). Back on its
  // own also renders the footer, so a step with only a Back stays reachable.
  cta: FlowShellCta | null
  // The gate banner (milestone 2), rendered above the CTA row inside the
  // footer. A banner with no cta and no onBack still renders the footer —
  // it is the only thing in it.
  banner?: ReactNode
  // Any user input diverging from the initial state: closing asks "Discard
  // changes?"; a pristine (or completed) flow closes silently.
  dirty: boolean
  children: ReactNode
}

// The generalized channel-flow chrome (phase 1 TDD): OutreachSheet anatomy +
// sticky header with a badge/overline on the left and an Exit control on the
// right (the sheet's own corner X is suppressed so there is one close), the
// bar Stepper below, Back moved into the footer beside the primary, flat
// client flow state owned by the flow component, dirty-close confirm, fresh
// state on reopen. Step bodies stay dumb value/onChange components.
export const OutreachFlowShell = ({
  open,
  onClose,
  title,
  headerBadge,
  currentStep,
  totalSteps,
  onBack,
  cta,
  banner,
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

  // A React element is truthy even when it renders null, so `Boolean(banner)`
  // can't distinguish a gated GateBanner from an ungated one on its own —
  // the caller must pass `banner={state.requirement ? <GateBanner ... /> :
  // undefined}` (see GateBanner.tsx) rather than relying on this to hide an
  // empty footer for them.
  const showFooter = cta !== null || Boolean(onBack) || Boolean(banner)

  return (
    <>
      <OutreachSheet
        open={open}
        onOpenChange={requestClose}
        bodyRef={bodyRef}
        headerless={totalSteps === 0}
        hideClose
        header={
          <>
            {/* DrawerTitle stays sr-only for the drawer's accessible
                name — the visible overline/exit and the bars are the
                Stepper's job now (chunky bars + overline slot + Exit
                button all rendered by the styleguide component). */}
            <DrawerTitle className="sr-only">{title}</DrawerTitle>
            {totalSteps > 0 && (
              <Stepper
                variant="bar"
                currentStep={currentStep}
                totalSteps={totalSteps}
                overline={headerBadge}
                onExit={() => requestClose(false)}
              />
            )}
          </>
        }
        footer={
          showFooter ? (
            <>
              {banner}
              {(cta || onBack) && (
                // Prototype footer: row-reverse with the primary on the
                // right and Back on the left. Both stay on one row at every
                // width; do not stack on mobile.
                <div
                  className={`flex w-full flex-row-reverse items-center gap-3 ${
                    onBack ? 'justify-between' : ''
                  }`}
                >
                  {cta && (
                    <Button
                      type="button"
                      size="large"
                      className="min-w-0 flex-1 lg:min-w-[240px] lg:flex-none"
                      onClick={cta.onClick}
                      disabled={cta.disabled}
                      loading={cta.loading}
                    >
                      {cta.label}
                    </Button>
                  )}
                  {cta?.secondary && (
                    <Button
                      type="button"
                      size="large"
                      variant={cta.secondary.variant ?? 'ghost'}
                      className="min-w-0 flex-1 lg:min-w-[240px] lg:flex-none"
                      disabled={cta.secondary.disabled}
                      onClick={cta.secondary.onClick}
                    >
                      {cta.secondary.label}
                    </Button>
                  )}
                  {onBack && (
                    <Button
                      type="button"
                      size="large"
                      variant="ghost"
                      aria-label="Back"
                      className="shrink-0 lg:min-w-[140px]"
                      onClick={onBack}
                    >
                      Back
                    </Button>
                  )}
                </div>
              )}
            </>
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
              variant="destructive"
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
