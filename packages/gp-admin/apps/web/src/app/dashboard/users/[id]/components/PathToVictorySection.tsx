'use client'

import { Grid, Text, Box, Flex, Progress } from '@radix-ui/themes'
import { useUser } from '../UserProvider'
import { InfoCard } from './InfoCard'
import { DataRow } from './DataRow'
import { formatNumberForDisplay } from '@/lib/utils/number'

const PARTY_LABELS = {
  DEMOCRATS: 'Democrats',
  REPUBLICANS: 'Republicans',
  INDEPENDENTS: 'Independents',
} as const

const DEMOGRAPHIC_LABELS = {
  MEN: 'Men',
  WOMEN: 'Women',
  WHITE: 'White',
  HISPANIC: 'Hispanic',
  ASIAN: 'Asian',
  AFRICAN_AMERICAN: 'African American',
} as const

export function PathToVictorySection() {
  const user = useUser()
  const p2v = user.pathToVictory?.data
  if (!p2v) return null

  const totalRegistered = p2v.totalRegisteredVoters || 0
  const winNumber =
    typeof p2v.winNumber === 'string'
      ? parseFloat(p2v.winNumber)
      : p2v.winNumber || 0
  const winPercentage =
    totalRegistered > 0 ? (winNumber / totalRegistered) * 100 : 0

  const partyData = [
    {
      label: PARTY_LABELS.DEMOCRATS,
      value: p2v.democrats,
      color: 'blue' as const,
    },
    {
      label: PARTY_LABELS.REPUBLICANS,
      value: p2v.republicans,
      color: 'red' as const,
    },
    {
      label: PARTY_LABELS.INDEPENDENTS,
      value: p2v.indies,
      color: 'purple' as const,
    },
  ]

  const demographicData = [
    { label: DEMOGRAPHIC_LABELS.MEN, value: p2v.men },
    { label: DEMOGRAPHIC_LABELS.WOMEN, value: p2v.women },
    { label: DEMOGRAPHIC_LABELS.WHITE, value: p2v.white },
    { label: DEMOGRAPHIC_LABELS.HISPANIC, value: p2v.hispanic },
    { label: DEMOGRAPHIC_LABELS.ASIAN, value: p2v.asian },
    { label: DEMOGRAPHIC_LABELS.AFRICAN_AMERICAN, value: p2v.africanAmerican },
  ].filter((d) => d.value !== undefined)

  return (
    <Grid columns={{ initial: '1', md: '2' }} gap="4">
      <InfoCard title="Victory Metrics">
        <Flex direction="column" gap="4">
          <Box>
            <Flex justify="between" mb="2">
              <Text size="2" color="gray">
                Win Number
              </Text>
              <Text size="2" weight="bold" color="green">
                {formatNumberForDisplay(winNumber)}
              </Text>
            </Flex>
            <Progress value={winPercentage} max={100} color="green" />
            <Text size="1" color="gray">
              {winPercentage.toFixed(1)}% of registered voters
            </Text>
          </Box>
          <DataRow label="Voter Contact Goal">
            {formatNumberForDisplay(p2v.voterContactGoal)}
          </DataRow>
          <DataRow label="Projected Turnout">
            {formatNumberForDisplay(p2v.projectedTurnout)}
          </DataRow>
          <DataRow label="Average Turnout">
            {formatNumberForDisplay(p2v.averageTurnout)}
          </DataRow>
          <DataRow label="Total Registered Voters">
            {formatNumberForDisplay(p2v.totalRegisteredVoters)}
          </DataRow>
        </Flex>
      </InfoCard>

      <InfoCard title="Election Info">
        <DataRow label="Election Type">{p2v.electionType}</DataRow>
        <DataRow label="Location">{p2v.electionLocation}</DataRow>
        <DataRow label="P2V Status">{p2v.p2vStatus}</DataRow>
        <DataRow label="Source">{p2v.source}</DataRow>
        <DataRow label="P2V Complete Date">{p2v.p2vCompleteDate}</DataRow>
        {p2v.viability && (
          <>
            <DataRow label="Viability Score">{p2v.viability.score}</DataRow>
            <DataRow label="Seats">{p2v.viability.seats}</DataRow>
          </>
        )}
      </InfoCard>

      <InfoCard title="Party Breakdown">
        <Flex direction="column" gap="3">
          {partyData.map(({ label, value, color }) => (
            <Box key={label}>
              <Flex justify="between" mb="1">
                <Text size="2" color="gray">
                  {label}
                </Text>
                <Text size="2" weight="medium">
                  {formatNumberForDisplay(value)}
                </Text>
              </Flex>
              <Progress
                value={
                  totalRegistered > 0
                    ? ((value || 0) / totalRegistered) * 100
                    : 0
                }
                max={100}
                color={color}
              />
            </Box>
          ))}
        </Flex>
      </InfoCard>

      {demographicData.length > 0 && (
        <InfoCard title="Demographics">
          <Grid columns="2" gap="3">
            {demographicData.map(({ label, value }) => (
              <Box
                key={label}
                p="3"
                className="bg-[var(--gray-2)] rounded-md text-center"
              >
                <Text as="p" size="4" weight="bold">
                  {formatNumberForDisplay(value)}
                </Text>
                <Text as="p" size="1" color="gray">
                  {label}
                </Text>
              </Box>
            ))}
          </Grid>
        </InfoCard>
      )}
    </Grid>
  )
}
