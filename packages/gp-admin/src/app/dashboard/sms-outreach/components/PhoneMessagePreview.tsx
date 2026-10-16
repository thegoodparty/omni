'use client'

import { useCallback, useState } from 'react'
import { Box, Callout, Flex, Text } from '@radix-ui/themes'
import {
  getImageAspectWarning,
  MAX_TALL_RATIO,
  MAX_WIDE_RATIO,
} from './imageAspect'

const BUBBLE_GRAY = '#e5e5ea'
const IMAGE_WIDTH = 200

const WARNING_COPY = {
  tall: 'Phones will crop the top and bottom.',
  wide: 'Phones will crop the sides.',
} as const

interface PhoneMessagePreviewProps {
  imageUrl: string | null
  script: string | null
}

interface NaturalSize {
  width: number
  height: number
}

export function PhoneMessagePreview({
  imageUrl,
  script,
}: PhoneMessagePreviewProps) {
  const [size, setSize] = useState<NaturalSize | null>(null)

  const readSize = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth > 0) {
      setSize({ width: img.naturalWidth, height: img.naturalHeight })
    }
  }, [])

  const warning = size ? getImageAspectWarning(size.width, size.height) : null

  return (
    <Flex direction="column" gap="2">
      <Box
        style={{
          width: '100%',
          maxWidth: 320,
          padding: '20px 12px 16px 16px',
          borderRadius: 32,
          border: '1px solid var(--gray-6)',
          background: '#fff',
          color: '#000',
        }}
      >
        <Flex direction="column" align="start" gap="1">
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={readSize}
              src={imageUrl}
              alt="Campaign attachment"
              onLoad={(e) => readSize(e.currentTarget)}
              style={{
                display: 'block',
                width: IMAGE_WIDTH,
                height: 'auto',
                minHeight: IMAGE_WIDTH * (1 / MAX_WIDE_RATIO),
                maxHeight: IMAGE_WIDTH * (1 / MAX_TALL_RATIO),
                objectFit: 'cover',
                borderRadius: 18,
              }}
            />
          )}
          {script ? (
            <Box
              style={{
                position: 'relative',
                maxWidth: '80%',
                padding: '8px 12px',
                borderRadius: 18,
                background: BUBBLE_GRAY,
                fontSize: 15,
                lineHeight: 1.35,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {script}
              <svg
                aria-hidden
                width="12"
                height="16"
                viewBox="0 0 12 16"
                style={{ position: 'absolute', left: -5, bottom: 0 }}
              >
                <path
                  d="M5 0 L5 8 Q5 15 0 16 Q7 16 12 12 L12 0 Z"
                  fill={BUBBLE_GRAY}
                />
              </svg>
            </Box>
          ) : (
            !imageUrl && <Text size="2">—</Text>
          )}
        </Flex>
      </Box>
      {size && warning && (
        <Callout.Root color="amber" size="1" style={{ maxWidth: 320 }}>
          <Callout.Text>
            Very {warning} image ({size.width} × {size.height} px).{' '}
            {WARNING_COPY[warning]}
          </Callout.Text>
        </Callout.Root>
      )}
    </Flex>
  )
}
