'use client'

import { Box, Text, Badge, Flex, Heading, Grid } from '@radix-ui/themes'
import { useUser } from '../UserProvider'
import { InfoCard } from './InfoCard'
import type { TopIssuePosition } from '../types'

export function TopIssuesSection() {
  const user = useUser()
  const { topIssues, customIssues } = user.details
  if (!topIssues && !customIssues) return null

  const positions = topIssues?.positions || []

  return (
    <Grid columns={{ initial: '1', md: '2' }} gap="4">
      {positions.length > 0 && (
        <InfoCard title="Top Issues & Positions">
          <Flex direction="column" gap="4">
            {positions.map((position: TopIssuePosition) => {
              const positionKey = `position-${position.id}`
              const candidatePosition = topIssues[positionKey] as
                | string
                | undefined

              return (
                <Box
                  key={position.id}
                  p="3"
                  className="bg-[var(--gray-2)] rounded-md"
                >
                  <Flex gap="2" align="center" mb="2">
                    <Badge color="iris" variant="soft">
                      {position.topIssue.name}
                    </Badge>
                  </Flex>
                  <Heading size="2" mb="2">
                    {position.name}
                  </Heading>
                  {candidatePosition && (
                    <Text as="p" size="2" color="gray">
                      Position: {candidatePosition}
                    </Text>
                  )}
                </Box>
              )
            })}
          </Flex>
        </InfoCard>
      )}

      {customIssues && customIssues.length > 0 && (
        <InfoCard title="Custom Issues">
          <Flex direction="column" gap="3">
            {customIssues.map((issue, index) => (
              <Box key={index} p="3" className="bg-[var(--gray-2)] rounded-md">
                <Heading size="2" mb="1">
                  {issue.title}
                </Heading>
                <Text as="p" size="2" color="gray">
                  {issue.position}
                </Text>
              </Box>
            ))}
          </Flex>
        </InfoCard>
      )}
    </Grid>
  )
}
