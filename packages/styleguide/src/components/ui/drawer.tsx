// Drawer (vaul) and Sheet (Radix Dialog) are intentionally separate primitives.
import * as React from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'

import { cn } from '@styleguide/lib/utils'
import { XMarkIcon } from './icons'

// Shared content-column widths applied by DrawerContent to header / body /
// footer. `'app'` (608px / 38rem) is the canonical width for the app's
// bottom-sheet flows; the rest of the scale is Tailwind's own `max-w-*`
// vocabulary. Set the value on DrawerContent and every slot inherits it via
// a CSS variable — callers do not repeat the wrapper.
type DrawerMaxWidth =
  | 'app'
  | 'xs'
  | 'sm'
  | 'md'
  | 'lg'
  | 'xl'
  | '2xl'
  | '3xl'
  | '4xl'
  | '5xl'

const MAX_WIDTH_REM: Record<DrawerMaxWidth, string> = {
  app: '38rem',
  xs: '20rem',
  sm: '24rem',
  md: '28rem',
  lg: '32rem',
  xl: '36rem',
  '2xl': '42rem',
  '3xl': '48rem',
  '4xl': '56rem',
  '5xl': '64rem',
}

// `max-w-[var(--drawer-content-width,none)]` resolves to `max-width: none`
// when `fullWidth` is set on DrawerContent (which unsets the variable). The
// centering wrapper is a no-op at full width, so there is no visual cost.
const columnClass = 'mx-auto w-full max-w-[var(--drawer-content-width,none)]'

function Drawer({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />
}

function DrawerTrigger({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerPortal({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal {...props} />
}

function DrawerClose({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-surface-overlay/50',
        className,
      )}
      {...props}
    />
  )
}

function DrawerHandle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-handle"
      // `bg-muted-foreground/50` rather than `bg-border` so the handle
      // actually reads against the drawer's `bg-background` — border-tinted
      // on card-tinted is near-invisible, and a handle a candidate can't
      // see is one they won't reach for.
      className={cn(
        'bg-muted-foreground/50 mx-auto mt-4 mb-2 h-2 w-30 rounded-full',
        className,
      )}
      {...props}
    />
  )
}

function DrawerContent({
  className,
  closeClassName,
  children,
  maxWidth = 'app',
  fullWidth = false,
  style,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content> & {
  closeClassName?: string
  // Shared content-column width across header, body, and footer. Defaults
  // to `'app'` (608px) — the canonical bottom-sheet width. Pass a Tailwind
  // scale token to override, or `fullWidth` to opt out entirely.
  maxWidth?: DrawerMaxWidth
  // Content spans the full panel width — the three slots do not share a
  // constrained column. Use for chat surfaces, image galleries, and other
  // content that is meant to fill the panel edge to edge.
  fullWidth?: boolean
}) {
  // DrawerHeader renders its own close inside the shared column so the X
  // aligns with the title. When a caller uses DrawerHeader without
  // `hideClose`, the floating fallback below would be a second X —
  // suppress it. If the header sets `hideClose` (e.g. it composes its own
  // custom close), keep the floating fallback so callers still get one X.
  const headerRendersClose = React.Children.toArray(children).some((child) => {
    if (!React.isValidElement(child) || child.type !== DrawerHeader) {
      return false
    }
    const { hideClose } = child.props as { hideClose?: boolean }
    return !hideClose
  })
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          'bg-background text-foreground fixed z-50 flex h-auto flex-col',
          'data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0 data-[vaul-drawer-direction=top]:mb-24 data-[vaul-drawer-direction=top]:max-h-[80vh] data-[vaul-drawer-direction=top]:rounded-b-2xl data-[vaul-drawer-direction=top]:border-b',
          'data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:bottom-0 data-[vaul-drawer-direction=bottom]:mt-24 data-[vaul-drawer-direction=bottom]:max-h-[80vh] data-[vaul-drawer-direction=bottom]:rounded-t-2xl data-[vaul-drawer-direction=bottom]:border-t',
          'data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:w-3/4 data-[vaul-drawer-direction=right]:border-l data-[vaul-drawer-direction=right]:sm:max-w-sm',
          'data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:left-0 data-[vaul-drawer-direction=left]:w-3/4 data-[vaul-drawer-direction=left]:border-r data-[vaul-drawer-direction=left]:sm:max-w-sm',
          className,
        )}
        style={
          fullWidth
            ? style
            : ({
                ...style,
                '--drawer-content-width': MAX_WIDTH_REM[maxWidth],
              } as React.CSSProperties)
        }
        {...props}
      >
        {!headerRendersClose && (
          <DrawerPrimitive.Close
            // Fallback for consumers that don't render a DrawerHeader — the
            // header owns the close when it's present. Positioned to the
            // shared column's right edge, matching where DrawerHeader would
            // put it.
            style={{
              right:
                'max(1rem, calc((100% - var(--drawer-content-width, 100%)) / 2))',
            }}
            className={cn(
              'absolute top-3 z-10 inline-flex size-10 items-center justify-center rounded-full text-foreground opacity-70 transition-opacity hover:bg-muted hover:opacity-100 focus-visible:ring-2 focus-visible:ring-primary-focus focus-visible:outline-none disabled:pointer-events-none',
              closeClassName,
            )}
            aria-label="Close"
          >
            <XMarkIcon className="size-5" />
            <span className="sr-only">Close</span>
          </DrawerPrimitive.Close>
        )}
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  )
}

function DrawerBody({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-body"
      className={cn('flex-1 overflow-y-auto px-4', className)}
      {...props}
    >
      <div className={columnClass}>{children}</div>
    </div>
  )
}

function DrawerHeader({
  className,
  children,
  hideClose = false,
  ...props
}: React.ComponentProps<'div'> & {
  // Suppress the built-in close on the right of the header. Use when the
  // header composes its own custom close (e.g. an "Exit" button beside a
  // channel badge). Default: render the close.
  hideClose?: boolean
}) {
  return (
    <div data-slot="drawer-header" className={cn('p-4', className)} {...props}>
      <div className={cn(columnClass, 'flex items-start gap-3')}>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">{children}</div>
        {!hideClose && (
          <DrawerPrimitive.Close
            // `-mt-1` optically aligns the 40x40 hit target with the title's
            // first line: title padding is `p-4` = 16px, so its cap starts
            // at 16px; the button's top at 12px + 20px half-height = 32px
            // matches the title's ~30px center.
            className="-mt-1 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-foreground opacity-70 transition-opacity hover:bg-muted hover:opacity-100 focus-visible:ring-2 focus-visible:ring-primary-focus focus-visible:outline-none disabled:pointer-events-none"
            aria-label="Close"
          >
            <XMarkIcon className="size-5" />
            <span className="sr-only">Close</span>
          </DrawerPrimitive.Close>
        )}
      </div>
    </div>
  )
}

function DrawerFooter({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn('mt-auto p-4', className)}
      {...props}
    >
      <div className={cn(columnClass, 'flex flex-col gap-2')}>{children}</div>
    </div>
  )
}

function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn('text-xl font-semibold', className)}
      {...props}
    />
  )
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn('text-muted-foreground text-base', className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerTrigger,
  DrawerPortal,
  DrawerClose,
  DrawerOverlay,
  DrawerHandle,
  DrawerContent,
  DrawerBody,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
