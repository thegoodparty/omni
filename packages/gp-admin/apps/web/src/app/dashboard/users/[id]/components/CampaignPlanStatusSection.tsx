import { Box, Text, Badge, Flex, Grid } from '@radix-ui/themes'
import { formatDate } from '@/lib/utils/date'
import { formatKeyAsLabel } from '@/lib/utils/string'
import { InfoCard } from './InfoCard'
import type { DetailedUser, CampaignPlanStatus } from '../types'

interface CampaignPlanStatusSectionProps {
  user: DetailedUser
}

function getStatusColor(status: string): 'green' | 'red' | 'orange' {
  switch (status) {
    case 'completed':
      return 'green'
    case 'failed':
      return 'red'
    default:
      return 'orange'
  }
}

export function CampaignPlanStatusSection({
  user,
}: CampaignPlanStatusSectionProps) {
  const planStatus = user.data.campaignPlanStatus
  if (!planStatus) return null

  const entries = Object.entries(planStatus) as [string, CampaignPlanStatus][]
  const completed = entries.filter(([, v]) => v.status === 'completed').length
  const total = entries.length

  return (
    <InfoCard title={`Campaign Plan Status (${completed}/${total} Complete)`}>
      <Grid columns={{ initial: '1', sm: '2', md: '3' }} gap="3">
        {entries.map(([key, value]) => (
          <Box key={key} p="3" className="bg-[var(--gray-2)] rounded-md">
            <Flex justify="between" align="center" mb="1">
              <Text size="2" weight="medium">
                {formatKeyAsLabel(key)}
              </Text>
              <Badge color={getStatusColor(value.status)} size="1">
                {value.status}
              </Badge>
            </Flex>
            <Text size="1" color="gray">
              {formatDate(value.createdAt)}
            </Text>
          </Box>
        ))}
      </Grid>
    </InfoCard>
  )
}
