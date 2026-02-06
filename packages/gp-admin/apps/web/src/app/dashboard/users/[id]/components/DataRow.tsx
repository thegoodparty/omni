import { Flex, Text } from '@radix-ui/themes'
import type { ReactNode } from 'react'

interface DataRowProps {
  label: string
  children: ReactNode
}

export function DataRow({ label, children }: DataRowProps) {
  return (
    <Flex justify="between" py="2" className="border-b border-[var(--gray-4)]">
      <Text size="2" color="gray">
        {label}
      </Text>
      <Text size="2" weight="medium">
        {children ?? '-'}
      </Text>
    </Flex>
  )
}
