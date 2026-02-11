import { Box, Heading, Flex } from '@radix-ui/themes'
import type { ReactNode } from 'react'

interface InfoCardProps {
  title: string
  children: ReactNode
  action?: ReactNode
}

export function InfoCard({ title, children, action }: InfoCardProps) {
  return (
    <Box className="border border-[var(--gray-5)] rounded-lg" p="4">
      <Flex justify="between" align="center" mb="4">
        <Heading size="4">{title}</Heading>
        {action}
      </Flex>
      {children}
    </Box>
  )
}
