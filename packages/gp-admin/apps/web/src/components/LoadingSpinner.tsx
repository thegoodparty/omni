'use client'

import { Flex, Spinner, Text } from '@radix-ui/themes'

interface LoadingSpinnerProps {
  size?: '1' | '2' | '3'
  text?: string
  showText?: boolean
  p?: '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
}

export function LoadingSpinner({
  size = '3',
  text = 'Loading...',
  showText = true,
  p = '8',
}: LoadingSpinnerProps) {
  return (
    <Flex align="center" justify="center" p={p} gap="3">
      <Spinner size={size} />
      {showText && (
        <Text size="3" color="gray">
          {text}
        </Text>
      )}
    </Flex>
  )
}
