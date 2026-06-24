'use client'

import * as React from 'react'
import * as AccordionPrimitive from '@radix-ui/react-accordion'

import { cn } from '@styleguide/lib/utils'
import { ChevronDownIcon } from './icons'

type AccordionSize = 'default' | 'sm'

const AccordionContext = React.createContext<{ size: AccordionSize }>({
  size: 'default',
})

function Accordion({
  size = 'default',
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Root> & {
  size?: AccordionSize
}) {
  return (
    <AccordionContext.Provider value={{ size }}>
      <AccordionPrimitive.Root data-slot="accordion" {...props} />
    </AccordionContext.Provider>
  )
}

function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn('border-b border-border last:border-b-0', className)}
      {...props}
    />
  )
}

function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  const { size } = React.useContext(AccordionContext)
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          'focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-start justify-between gap-4 rounded-md text-left text-sm font-medium text-foreground transition-all outline-none hover:underline focus-visible:underline focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&[data-state=open]>svg]:rotate-180',
          size === 'sm' ? 'py-3' : 'py-4',
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon className="text-muted-foreground pointer-events-none size-4 shrink-0 translate-y-0.5 transition-transform duration-200" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  const { size } = React.useContext(AccordionContext)
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className={cn(
        'data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden text-sm text-foreground',
        className,
      )}
      {...props}
    >
      <div className={size === 'sm' ? 'pt-0 pb-3' : 'pt-0 pb-4'}>
        {children}
      </div>
    </AccordionPrimitive.Content>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
