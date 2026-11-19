'use client'

import * as React from 'react'
import * as AspectRatioPrimitive from '@radix-ui/react-aspect-ratio'

/**
 * @summary Use to keep an image, video or map at a fixed shape, like 16:9, as
 * its width changes.
 */
function AspectRatio({
  ...props
}: React.ComponentProps<typeof AspectRatioPrimitive.Root>) {
  return <AspectRatioPrimitive.Root data-slot="aspect-ratio" {...props} />
}

export { AspectRatio }
