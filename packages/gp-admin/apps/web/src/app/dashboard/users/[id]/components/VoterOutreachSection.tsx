'use client'

import { Grid, Text, Box, Flex } from '@radix-ui/themes'
import { formatNumberForDisplay } from '@/lib/utils/number'
import { formatKeyAsLabel } from '@/lib/utils/string'
import { useUser } from '../UserProvider'
import { InfoCard } from './InfoCard'

export function VoterOutreachSection() {
  const user = useUser()
  const goals = user.data.reportedVoterGoals
  if (!goals) return null

  const entries = Object.entries(goals).filter(
    ([, value]) => typeof value === 'number'
  )
  const totalContacts = entries.reduce(
    (sum, [, value]) => sum + (value as number),
    0
  )

  return (
    <InfoCard title="Reported Voter Outreach Goals">
      <Flex direction="column" gap="4">
        <Box p="4" className="bg-[var(--accent-2)] rounded-lg text-center">
          <Text as="p" size="6" weight="bold" color="blue">
            {formatNumberForDisplay(totalContacts)}
          </Text>
          <Text as="p" size="2" color="gray">
            Total Voter Contacts
          </Text>
        </Box>
        <Grid columns={{ initial: '2', md: '3', lg: '5' }} gap="3">
          {entries.map(([key, value]) => (
            <Box
              key={key}
              p="3"
              className="bg-[var(--gray-2)] rounded-md text-center"
            >
              <Text as="p" size="4" weight="bold">
                {formatNumberForDisplay(value as number)}
              </Text>
              <Text as="p" size="1" color="gray">
                {formatKeyAsLabel(key)}
              </Text>
            </Box>
          ))}
        </Grid>
      </Flex>
    </InfoCard>
  )
}
