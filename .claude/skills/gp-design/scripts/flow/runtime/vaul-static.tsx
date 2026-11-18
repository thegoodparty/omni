// The build-time snapshot's stand-in for vaul, which reads document while it renders.
// Each part renders its children in place, so check.py can read a drawer's words.
import * as React from 'react'

type Props = { children?: React.ReactNode; asChild?: boolean } & Record<
  string,
  unknown
>

const drop = new Set([
  'open',
  'defaultOpen',
  'onOpenChange',
  'modal',
  'direction',
  'dismissible',
  'shouldScaleBackground',
  'setBackgroundColorOnScale',
  'snapPoints',
  'activeSnapPoint',
  'setActiveSnapPoint',
  'fadeFromIndex',
  'onDrag',
  'onRelease',
  'onClose',
  'nested',
  'handleOnly',
  'noBodyStyles',
  'repositionInputs',
  'forceMount',
  'container',
  'onAnimationEnd',
  'preventScrollRestoration',
  'disablePreventScroll',
])

const part = (tag: string) =>
  React.forwardRef<HTMLElement, Props>(
    ({ children, asChild, ...rest }, ref) => {
      const props = Object.fromEntries(
        Object.entries(rest).filter(
          ([k]) => !drop.has(k) && typeof rest[k] !== 'function',
        ),
      )
      if (asChild && React.isValidElement(children)) return children
      return React.createElement(tag, { ref, ...props }, children)
    },
  )

const Fragment = ({ children }: Props) => <>{children}</>

export const Drawer = {
  Root: Fragment,
  NestedRoot: Fragment,
  Portal: Fragment,
  Trigger: part('button'),
  Close: part('button'),
  Overlay: part('div'),
  Content: part('div'),
  Title: part('h2'),
  Description: part('p'),
  Handle: part('div'),
}
