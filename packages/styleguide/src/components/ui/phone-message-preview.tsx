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

const FALLBACK_SENDER = 'Your campaign'

const getInitials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word.match(/[\p{L}\p{N}]/u)?.[0] ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

interface PhoneMessagePreviewProps extends Omit<
  React.ComponentProps<'div'>,
  'children'
> {
  imageUrl: string | null
  script: string | null
  senderName?: string | null
  getAspectWarning?: (width: number, height: number) => AspectWarning | null
}

/**
 * Renders an iPhone Messages mockup. The image renders 250px wide; its height
 * follows the image between 125px and 500px (2:1 to 1:2), the range a phone
 * shows without cropping. Pass getAspectWarning to warn when the image falls
 * outside it. The composer bar is decorative.
 *
 * @summary Use to show a text message with an optional image as a phone
 * displays it. For a message the user types, use Textarea.
 */
function PhoneMessagePreview({
  imageUrl,
  script,
  senderName,
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

  const sender = senderName?.trim() || FALLBACK_SENDER
  const initials = getInitials(sender)

  return (
    <div
      data-slot="phone-message-preview"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    >
      <div className="w-full max-w-[418px] rounded-[66px] bg-[#1B1B1D] p-3.5 font-[-apple-system,'SF_Pro_Text','Helvetica_Neue',Inter,Arial,sans-serif] shadow-[0_30px_60px_rgba(20,24,40,0.28)] max-sm:rounded-[48px] max-sm:p-3">
        <div className="relative flex min-h-[640px] flex-col overflow-hidden rounded-[52px] bg-white text-black max-sm:rounded-[38px]">
          <div
            aria-hidden
            className="absolute top-[11px] left-1/2 h-[34px] w-[120px] -translate-x-1/2 rounded-[20px] bg-black"
          />
          <div className="flex items-start justify-between border-b border-[#D8D8DD] bg-[#F6F6F8] px-4 pt-14 pb-2.5">
            <div className="flex h-[52px] w-[60px] items-center">
              <svg
                aria-hidden
                width="14"
                height="24"
                viewBox="0 0 14 24"
                fill="none"
                stroke="#0A6CFF"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M11 2 L3 12 L11 22" />
              </svg>
            </div>
            <div className="flex min-w-0 flex-col items-center gap-1">
              <div
                aria-hidden
                className="flex size-[52px] items-center justify-center rounded-full bg-[#6E7079] text-xl font-semibold text-white"
              >
                {initials}
              </div>
              <div className="flex max-w-full items-center gap-1 text-xs">
                <span className="truncate">{sender}</span>
                <svg
                  aria-hidden
                  width="6"
                  height="10"
                  viewBox="0 0 6 10"
                  fill="none"
                  stroke="#6E7079"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0"
                >
                  <path d="M1 1 L5 5 L1 9" />
                </svg>
              </div>
            </div>
            <div className="h-[52px] w-[60px]" />
          </div>

          <div className="flex flex-1 flex-col gap-1 px-4 pt-3.5 pb-3">
            <div className="self-center pb-2 text-center text-[11px] leading-[1.3] text-[#6B6B70]">
              <strong className="font-semibold">Text Message</strong>
              <br />
              Today 9:41 AM
            </div>
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={readSize}
                src={imageUrl}
                alt="Campaign attachment"
                onLoad={(e) => readSize(e.currentTarget)}
                className="block h-auto max-h-[500px] min-h-[125px] w-[250px] max-w-full rounded-[20px] object-cover"
              />
            )}
            {script ? (
              <div className="relative max-w-[276px] self-start rounded-[20px] bg-[#E9E9EB] px-3.5 py-[9px] text-base leading-[1.3] wrap-anywhere whitespace-pre-wrap before:absolute before:bottom-0 before:-left-[7px] before:h-5 before:w-5 before:rounded-br-[16px_14px] before:bg-[#E9E9EB] before:content-[''] after:absolute after:bottom-0 after:-left-[26px] after:h-5 after:w-[26px] after:rounded-br-[10px] after:bg-white after:content-['']">
                {script}
              </div>
            ) : (
              !imageUrl && <span className="text-sm">—</span>
            )}
          </div>

          <div
            aria-hidden
            className="flex items-center gap-2.5 bg-white px-3 pt-2 pb-[34px]"
          >
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#E9E9EB]">
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                stroke="#5A5A60"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <path d="M9 2 V16 M2 9 H16" />
              </svg>
            </div>
            <div className="flex h-11 min-w-0 flex-1 items-center rounded-full border border-[#C9C9CF] px-4 text-base text-[#8E8E93]">
              Text Message
            </div>
          </div>
          <div
            aria-hidden
            className="absolute bottom-2 left-1/2 h-[5px] w-[134px] -translate-x-1/2 rounded-[3px] bg-black"
          />
        </div>
      </div>
      {size && warning && (
        <Alert className="max-w-[418px] border-warning py-2 text-warning-dark">
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
