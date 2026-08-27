'use client'

import { useContext, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@styleguide'
import { TakeoverFooterSlotContext } from 'app/dashboard/shared/takeover/TakeoverShell'

export interface WizardFooterAction {
  label?: string
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  loadingText?: string
}

interface WizardStepFooterProps {
  primary?: WizardFooterAction
  back?: WizardFooterAction
  // Success-style screens center the primary alone (design: pending/paid).
  centered?: boolean
}

// Same guard as DashboardNavHeaderAction: this renders on the server too.
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

// One footer, two presentations. Under the takeover chrome (TakeoverShell in
// context) the actions portal into the shell's pinned bottom bar with the
// design's anatomy — primary right (min-w 240) / ghost Back left (min-w 140)
// on desktop, stacked full-width primary-on-top on mobile. Under the legacy
// wizard chrome they render in place with the exact markup every step carried
// inline before this component existed, so the un-forked entry points are
// byte-identical.
const WizardStepFooter = ({
  primary,
  back,
  centered = false,
}: WizardStepFooterProps) => {
  const { element, register } = useContext(TakeoverFooterSlotContext)

  useIsomorphicLayoutEffect(() => {
    register(1)
    return () => register(-1)
  }, [register])

  if (element) {
    return createPortal(
      <div
        className={`flex w-full flex-col gap-3 lg:flex-row-reverse ${
          centered ? 'lg:justify-center' : 'lg:justify-between'
        }`}
      >
        {primary && (
          <Button
            size="large"
            className="w-full lg:w-auto lg:min-w-[240px]"
            onClick={primary.onClick}
            disabled={primary.disabled}
            loading={primary.loading}
            loadingText={primary.loadingText ?? 'Processing…'}
          >
            {primary.label ?? 'Continue'}
          </Button>
        )}
        {back && (
          <Button
            variant="ghost"
            size="large"
            className="w-full lg:w-auto lg:min-w-[140px]"
            onClick={back.onClick}
            disabled={back.disabled}
          >
            {back.label ?? 'Back'}
          </Button>
        )}
      </div>,
      element,
    )
  }

  if (!primary) {
    return back ? (
      <div className="mt-8">
        <Button variant="outline" size="large" onClick={back.onClick}>
          {back.label ?? 'Back'}
        </Button>
      </div>
    ) : null
  }

  return (
    <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
      {back && (
        <Button
          variant="outline"
          size="large"
          className="w-full sm:w-auto"
          onClick={back.onClick}
        >
          {back.label ?? 'Back'}
        </Button>
      )}
      <Button
        size="large"
        className="w-full sm:w-auto"
        onClick={primary.onClick}
        disabled={primary.disabled}
        loading={primary.loading}
        loadingText={primary.loadingText}
      >
        {primary.label ?? 'Continue'}
      </Button>
    </div>
  )
}

export default WizardStepFooter
