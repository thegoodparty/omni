'use client'
import { useContext, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useFormData } from '@shared/hooks/useFormData'
import { TakeoverFooterSlotContext } from 'app/dashboard/shared/takeover/TakeoverShell'

interface TextingComplianceFooterProps {
  children: React.ReactNode
}

const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect

// The compliance forms' submit bar. Under a TakeoverShell (the compliance
// pages now render inside the Voter Outreach 2.0 takeover chrome) the actions
// portal into the shell's pinned footer with the design's row anatomy; the
// standalone fixed bar remains for any mount outside a shell (tests, legacy).
export default function TextingComplianceFooter({
  children,
}: TextingComplianceFooterProps): React.JSX.Element {
  useFormData()
  const { element, register } = useContext(TakeoverFooterSlotContext)

  useIsomorphicLayoutEffect(() => {
    register(1)
    return () => register(-1)
  }, [register])

  if (element) {
    return createPortal(
      <div className="flex w-full flex-col gap-3 lg:flex-row-reverse lg:justify-between">
        {children}
      </div>,
      element,
    )
  }

  return (
    <div
      className="
        fixed
        bottom-0
        left-0
        right-0
        border-t
        border-gray-200
        bg-white
        p-4
        md:mx-auto
        md:max-w-2xl
        md:border-0
        md:p-8
        z-10
      "
    >
      <div className="flex gap-4 justify-end">{children}</div>
    </div>
  )
}
