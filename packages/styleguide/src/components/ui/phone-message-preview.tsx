'use client'

import * as React from 'react'

import { cn } from '@styleguide/lib/utils'
import { Alert, AlertDescription } from './alert'

type AspectWarning = 'wide' | 'tall'

const WARNING_COPY: Record<AspectWarning, string> = {
  tall: 'Phones will crop the top and bottom.',
  wide: 'Phones will crop the sides.',
}

interface NaturalSize {
  width: number
  height: number
}

interface PhoneMessagePreviewProps extends Omit<
  React.ComponentProps<'div'>,
  'children'
> {
  imageUrl: string | null
  script: string | null
  getAspectWarning?: (width: number, height: number) => AspectWarning | null
}

/**
 * The image renders 200px wide; its height follows the image between 100px
 * and 400px (2:1 to 1:2), the range a phone shows without cropping. Pass
 * getAspectWarning to warn when the image falls outside it.
 *
 * @summary Use to show a text message with an optional image as a phone
 * displays it. For a message the user types, use Textarea.
 */
function PhoneMessagePreview({
  imageUrl,
  script,
  getAspectWarning,
  className,
  ...props
}: PhoneMessagePreviewProps) {
  const [size, setSize] = React.useState<NaturalSize | null>(null)

  const readSize = React.useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth > 0) {
      setSize({ width: img.naturalWidth, height: img.naturalHeight })
    }
  }, [])

  const warning =
    size && getAspectWarning ? getAspectWarning(size.width, size.height) : null

  return (
    <div
      data-slot="phone-message-preview"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    >
      <div className="flex w-full max-w-80 flex-col items-start gap-1 rounded-[32px] border border-border bg-white pt-5 pr-3 pb-4 pl-4 text-black">
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={readSize}
            src={imageUrl}
            alt="Campaign attachment"
            onLoad={(e) => readSize(e.currentTarget)}
            className="block h-auto max-h-[400px] min-h-[100px] w-[200px] rounded-[18px] object-cover"
          />
        )}
        {script ? (
          <div className="relative max-w-[80%] rounded-[18px] bg-[#e5e5ea] px-3 py-2 text-[15px] leading-[1.35] wrap-anywhere whitespace-pre-wrap">
            {script}
            <svg
              aria-hidden
              width="12"
              height="16"
              viewBox="0 0 12 16"
              className="absolute bottom-0 -left-[5px]"
            >
              <path
                d="M5 0 L5 8 Q5 15 0 16 Q7 16 12 12 L12 0 Z"
                fill="#e5e5ea"
              />
            </svg>
          </div>
        ) : (
          !imageUrl && <span className="text-sm">—</span>
        )}
      </div>
      {size && warning && (
        <Alert className="max-w-80 border-warning py-2 text-warning-dark">
          <AlertDescription>
            Very {warning} image ({size.width} × {size.height} px).{' '}
            {WARNING_COPY[warning]}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

export { PhoneMessagePreview }
export type { PhoneMessagePreviewProps }
