// Stands in for @radix-ui/react-portal, which every Dialog, Drawer, Sheet, Select,
// Popover and Tooltip uses: overlays open inside the frame, not on <body>. In the
// build-time snapshot there is no document, so the content renders in place.
import * as React from 'react'
import { Portal as RadixPortal } from 'gp-radix-portal'
import { useFrame } from './frame'

type Props = React.ComponentProps<typeof RadixPortal>

export const Portal = React.forwardRef<HTMLDivElement, Props>(
  ({ container, ...props }, ref) => {
    const { el } = useFrame()
    if (typeof document === 'undefined')
      return <div ref={ref} data-gp-portal="" {...props} />
    return (
      <RadixPortal
        ref={ref}
        container={container ?? el ?? undefined}
        {...props}
      />
    )
  },
)
Portal.displayName = 'Portal'

export const Root = Portal
