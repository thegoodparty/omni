'use client'

import { Grid, Text, Box, Flex, Progress } from '@radix-ui/themes'
import { formatNumber } from '@/lib/utils/number'
import { useUser } from '../UserProvider'
import { InfoCard } from './InfoCard'
import { DataRow } from './DataRow'

export function PathToVictorySection() {
  const user = useUser()
  const p2v = user.pathToVictory?.data || user.data.pathToVictory
  if (!p2v) return null

  const totalRegistered = p2v.totalRegisteredVoters || 0
  const winNumber =
    typeof p2v.winNumber === 'string'
      ? parseFloat(p2v.winNumber)
      : p2v.winNumber || 0
  const winPercentage =
    totalRegistered > 0 ? (winNumber / totalRegistered) * 100 : 0

  const partyData = [
    { label: 'Democrats', value: p2v.democrats, color: 'blue' as const },
    { label: 'Republicans', value: p2v.republicans, color: 'red' as const },
    { label: 'Independents', value: p2v.indies, color: 'purple' as const },
  ]

  const demographicData = [
    { label: 'Men', value: p2v.men },
    { label: 'Women', value: p2v.women },
    { label: 'White', value: p2v.white },
    { label: 'Hispanic', value: p2v.hispanic },
    { label: 'Asian', value: p2v.asian },
    { label: 'African American', value: p2v.africanAmerican },
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
                {formatNumber(winNumber)}
              </Text>
            </Flex>
            <Progress value={winPercentage} max={100} color="green" />
            <Text size="1" color="gray">
              {winPercentage.toFixed(1)}% of registered voters
            </Text>
          </Box>
          <DataRow
            label="Voter Contact Goal"
            value={formatNumber(p2v.voterContactGoal)}
          />
          <DataRow
            label="Projected Turnout"
            value={formatNumber(p2v.projectedTurnout)}
          />
          <DataRow
            label="Average Turnout"
            value={formatNumber(p2v.averageTurnout)}
          />
          <DataRow
            label="Total Registered Voters"
            value={formatNumber(p2v.totalRegisteredVoters)}
          />
        </Flex>
      </InfoCard>

      <InfoCard title="Election Info">
        <DataRow label="Election Type" value={p2v.electionType} />
        <DataRow label="Location" value={p2v.electionLocation} />
        <DataRow label="P2V Status" value={p2v.p2vStatus} />
        <DataRow label="Source" value={p2v.source} />
        <DataRow label="P2V Complete Date" value={p2v.p2vCompleteDate} />
        {p2v.viability && (
          <>
            <DataRow label="Viability Score" value={p2v.viability.score} />
            <DataRow label="Seats" value={p2v.viability.seats} />
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
                  {formatNumber(value)}
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
                  {formatNumber(value)}
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
