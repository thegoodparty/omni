'use client'

import { Callout } from '@radix-ui/themes'
import { HiCheck } from 'react-icons/hi'

interface SuccessCalloutProps {
  message: string
  visible: boolean
}

/**
 * Reusable callout component for success messages
 */
export function SuccessCallout({ message, visible }: SuccessCalloutProps) {
  if (!visible) return null

  return (
    <Callout.Root color="green" mb="4">
      <Callout.Icon>
        <HiCheck />
      </Callout.Icon>
      <Callout.Text>{message}</Callout.Text>
    </Callout.Root>
  )
}
