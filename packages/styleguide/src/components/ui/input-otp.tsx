'use client'

import * as React from 'react'
import { OTPInput, OTPInputContext } from 'input-otp'

import { cn } from '@styleguide/lib/utils'
import { MinusIcon } from './icons'

function InputOTP({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<typeof OTPInput> & {
  containerClassName?: string
}) {
  return (
    <OTPInput
      data-slot="input-otp"
      containerClassName={cn(
        'flex items-center gap-2 has-disabled:opacity-50',
        containerClassName,
      )}
      className={cn('disabled:cursor-not-allowed', className)}
      {...props}
    />
  )
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-otp-group"
      className={cn('flex items-center', className)}
      {...props}
    />
  )
}

function InputOTPSlot({
  index,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  index: number
}) {
  const inputOTPContext = React.useContext(OTPInputContext)
  const slot = inputOTPContext?.slots[index]
  const { char, hasFakeCaret, isActive } = slot ?? {
    char: null,
    hasFakeCaret: false,
    isActive: false,
  }

  return (
    <div
      data-slot="input-otp-slot"
      data-active={isActive}
      className={cn(
        'data-[active=true]:border-components-input-active data-[active=true]:ring-components-input-focus data-[active=true]:aria-invalid:ring-destructive-focus aria-invalid:border-destructive data-[active=true]:aria-invalid:border-destructive border-components-input-border text-foreground relative -ml-px flex h-10 w-10 bg-components-input-base items-center justify-center border text-base transition-all outline-none first:ml-0 first:rounded-l-md last:rounded-r-md data-[active=true]:z-10 data-[active=true]:ring-[3px] md:text-sm',
        className,
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="animate-caret-blink bg-foreground h-4 w-px duration-1000" />
        </div>
      )}
    </div>
  )
}

function InputOTPSeparator({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-otp-separator"
      role="separator"
      className={cn('text-muted-foreground', className)}
      {...props}
    >
      <MinusIcon />
    </div>
  )
}

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator }
