'use client'

import { ComponentProps, ReactNode } from 'react'
import { Flex, Spinner } from '@radix-ui/themes'

interface LoadingSpinnerProps {
  size?: ComponentProps<typeof Spinner>['size']
  p?: ComponentProps<typeof Flex>['p']
  children?: ReactNode
}

export function LoadingSpinner({
  size = '3',
  p = '8',
  children,
}: LoadingSpinnerProps) {
  return (
    <Flex align="center" justify="center" p={p} gap="3">
      <Spinner size={size} />
      {children}
    </Flex>
  )
}
