'use client'

import { Grid, Text, Badge, Flex } from '@radix-ui/themes'
import { formatDate } from '@/lib/utils/date'
import { useUser } from '../UserProvider'
import { InfoCard } from './InfoCard'
import { DataRow } from './DataRow'

const STATUS_FLAGS = [
  { key: 'isActive', label: 'Active', trueColor: 'green' as const },
  { key: 'isVerified', label: 'Verified', trueColor: 'blue' as const },
  { key: 'isPro', label: 'Pro', trueColor: 'violet' as const },
  { key: 'isDemo', label: 'Demo Account', trueColor: 'amber' as const },
  { key: 'didWin', label: 'Won Election', trueColor: 'green' as const },
  {
    key: 'canDownloadFederal',
    label: 'Can Download Federal',
    trueColor: 'green' as const,
  },
] as const

export function CampaignStatusSection() {
  const user = useUser()
  const { data } = user

  return (
    <Grid columns={{ initial: '1', md: '2' }} gap="4">
      <InfoCard title="Campaign Status">
        <Flex direction="column" gap="3">
          {STATUS_FLAGS.map(({ key, label, trueColor }) => {
            const value = user[key as keyof typeof user]
            const isTrue = Boolean(value)
            return (
              <Flex key={key} justify="between" align="center">
                <Text size="2" color="gray">
                  {label}
                </Text>
                <Badge color={isTrue ? trueColor : 'gray'}>
                  {isTrue ? 'Yes' : 'No'}
                </Badge>
              </Flex>
            )
          })}
        </Flex>
      </InfoCard>

      <InfoCard title="Campaign Tier">
        <DataRow label="Tier">
          <Badge color="blue" variant="soft">
            {user.tier ?? 'None'}
          </Badge>
        </DataRow>
      </InfoCard>

      <InfoCard title="Campaign Data">
        <DataRow label="Campaign Name">{data.name}</DataRow>
        <DataRow label="Launch Status">
          <Badge
            color={data.launchStatus === 'launched' ? 'green' : 'orange'}
            variant="soft"
          >
            {data.launchStatus || 'Not launched'}
          </Badge>
        </DataRow>
      </InfoCard>

      <InfoCard title="Timeline">
        <DataRow label="Created">{formatDate(user.createdAt)}</DataRow>
        <DataRow label="Updated">{formatDate(user.updatedAt)}</DataRow>
        <DataRow label="Date Verified">
          {user.dateVerified ? formatDate(user.dateVerified) : 'Not verified'}
        </DataRow>
        <DataRow label="Last Visited">{formatDate(data.lastVisited)}</DataRow>
        <DataRow label="Last Step Date">{data.lastStepDate}</DataRow>
        <DataRow label="Current Step">{data.currentStep}</DataRow>
      </InfoCard>
    </Grid>
  )
}
