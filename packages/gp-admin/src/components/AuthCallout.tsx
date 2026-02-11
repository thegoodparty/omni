'use client'

import { Callout, Flex } from '@radix-ui/themes'
import { HiExclamation } from 'react-icons/hi'

type AuthCalloutColor = 'red' | 'amber'

interface AuthCalloutProps {
  message: string
  color?: AuthCalloutColor
  centered?: boolean
}

/**
 * Reusable callout component for auth-related messages
 */
export function AuthCallout({
  message,
  color = 'red',
  centered = false,
}: AuthCalloutProps) {
  const callout = (
    <Callout.Root color={color}>
      <Callout.Icon>
        <HiExclamation />
      </Callout.Icon>
      <Callout.Text>{message}</Callout.Text>
    </Callout.Root>
  )

  if (centered) {
    return (
      <Flex align="center" justify="center" p="8">
        {callout}
      </Flex>
    )
  }

  return callout
}
