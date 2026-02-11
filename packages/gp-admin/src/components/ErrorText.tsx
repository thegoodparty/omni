import { Text } from '@radix-ui/themes'
import { ReactNode } from 'react'

interface ErrorTextProps {
  children: ReactNode
}

export function ErrorText({ children }: ErrorTextProps) {
  return (
    <Text size="1" color="red" mt="1">
      {children}
    </Text>
  )
}
