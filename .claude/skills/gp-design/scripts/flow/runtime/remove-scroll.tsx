// Stands in for react-remove-scroll. A modal in a frame must not lock the review
// page's scroll, and an open dialog drawn as a state in Other states must not
// freeze the page. Renders its child as is.
import * as React from 'react'

type Props = { as?: React.ElementType; children?: React.ReactNode } & Record<
  string,
  unknown
>

const drop = [
  'allowPinchZoom',
  'shards',
  'enabled',
  'removeScrollBar',
  'inert',
  'noIsolation',
  'forwardProps',
  'gapMode',
  'noRelative',
  'lockRef',
  'sideCar',
]

export const RemoveScroll = Object.assign(
  React.forwardRef<HTMLElement, Props>(({ as, children, ...rest }, ref) => {
    const props = Object.fromEntries(
      Object.entries(rest).filter(([k]) => !drop.includes(k)),
    )
    const As = as ?? 'div'
    return (
      <As ref={ref} {...props}>
        {children}
      </As>
    )
  }),
  {
    classNames: {
      fullWidth: 'width-before-scroll-bar',
      zeroRight: 'right-scroll-bar-position',
    },
  },
)
export default RemoveScroll
