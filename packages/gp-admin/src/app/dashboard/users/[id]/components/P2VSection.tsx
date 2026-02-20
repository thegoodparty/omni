'use client'

import { Grid, Text, Box, Flex, Progress, Badge } from '@radix-ui/themes'
import { P2V_STATUS_VALUES } from '../constants'
import { InfoCard } from './InfoCard'
import { DataRow } from './DataRow'
import { formatNumberForDisplay } from '@/lib/utils/number'
import type { PathToVictory } from '@goodparty_org/sdk'

interface P2VSectionProps {
  p2v: PathToVictory | null
}

export function P2VSection({ p2v }: P2VSectionProps) {
  if (!p2v) {
    return (
      <InfoCard title="Path to Victory">
        <Text size="2" color="gray">
          No Path to Victory data available.
        </Text>
      </InfoCard>
    )
  }

  const data = p2v.data
  const totalRegistered = data.totalRegisteredVoters ?? 0
  const winNumber = data.winNumber ?? 0
  const winPercentage =
    totalRegistered > 0 ? (winNumber / totalRegistered) * 100 : 0

  return (
    <Grid columns={{ initial: '1', md: '2' }} gap="4">
      <InfoCard title="P2V Status">
        <DataRow label="Status">
          <Badge
            color={
              data.p2vStatus === P2V_STATUS_VALUES.COMPLETE ? 'green' : 'orange'
            }
            variant="soft"
          >
            {data.p2vStatus ?? 'Not set'}
          </Badge>
        </DataRow>
        <DataRow label="Election Type">{data.electionType}</DataRow>
        <DataRow label="Election Location">{data.electionLocation}</DataRow>
        <DataRow label="Source">{data.source}</DataRow>
        <DataRow label="P2V Complete Date">{data.p2vCompleteDate}</DataRow>
      </InfoCard>

      <InfoCard title="Target Numbers">
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
            {formatNumberForDisplay(data.voterContactGoal)}
          </DataRow>
          <DataRow label="Total Registered Voters">
            {formatNumberForDisplay(data.totalRegisteredVoters)}
          </DataRow>
          <DataRow label="Projected Turnout">
            {formatNumberForDisplay(data.projectedTurnout)}
          </DataRow>
          <DataRow label="Average Turnout">
            {formatNumberForDisplay(data.averageTurnout)}
          </DataRow>
        </Flex>
      </InfoCard>

      <InfoCard title="Demographics - Party Affiliation">
        <Flex direction="column" gap="3">
          <Box>
            <Flex justify="between" mb="1">
              <Text size="2" color="gray">
                Republicans
              </Text>
              <Text size="2" weight="medium">
                {formatNumberForDisplay(data.republicans)}
              </Text>
            </Flex>
            <Progress
              value={
                totalRegistered > 0
                  ? ((data.republicans || 0) / totalRegistered) * 100
                  : 0
              }
              max={100}
              color="red"
            />
          </Box>
          <Box>
            <Flex justify="between" mb="1">
              <Text size="2" color="gray">
                Democrats
              </Text>
              <Text size="2" weight="medium">
                {formatNumberForDisplay(data.democrats)}
              </Text>
            </Flex>
            <Progress
              value={
                totalRegistered > 0
                  ? ((data.democrats || 0) / totalRegistered) * 100
                  : 0
              }
              max={100}
              color="blue"
            />
          </Box>
          <Box>
            <Flex justify="between" mb="1">
              <Text size="2" color="gray">
                Independents
              </Text>
              <Text size="2" weight="medium">
                {formatNumberForDisplay(data.indies)}
              </Text>
            </Flex>
            <Progress
              value={
                totalRegistered > 0
                  ? ((data.indies || 0) / totalRegistered) * 100
                  : 0
              }
              max={100}
              color="purple"
            />
          </Box>
        </Flex>
      </InfoCard>

      <InfoCard title="Demographics - Gender">
        <Grid columns="2" gap="3">
          <Box p="3" className="bg-[var(--gray-2)] rounded-md text-center">
            <Text as="p" size="4" weight="bold">
              {formatNumberForDisplay(data.men)}
            </Text>
            <Text as="p" size="1" color="gray">
              Men
            </Text>
          </Box>
          <Box p="3" className="bg-[var(--gray-2)] rounded-md text-center">
            <Text as="p" size="4" weight="bold">
              {formatNumberForDisplay(data.women)}
            </Text>
            <Text as="p" size="1" color="gray">
              Women
            </Text>
          </Box>
        </Grid>
      </InfoCard>

      <InfoCard title="Demographics - Race/Ethnicity">
        <Grid columns="2" gap="3">
          <Box p="3" className="bg-[var(--gray-2)] rounded-md text-center">
            <Text as="p" size="4" weight="bold">
              {formatNumberForDisplay(data.white)}
            </Text>
            <Text as="p" size="1" color="gray">
              White
            </Text>
          </Box>
          <Box p="3" className="bg-[var(--gray-2)] rounded-md text-center">
            <Text as="p" size="4" weight="bold">
              {formatNumberForDisplay(data.asian)}
            </Text>
            <Text as="p" size="1" color="gray">
              Asian
            </Text>
          </Box>
          <Box p="3" className="bg-[var(--gray-2)] rounded-md text-center">
            <Text as="p" size="4" weight="bold">
              {formatNumberForDisplay(data.africanAmerican)}
            </Text>
            <Text as="p" size="1" color="gray">
              African American
            </Text>
          </Box>
          <Box p="3" className="bg-[var(--gray-2)] rounded-md text-center">
            <Text as="p" size="4" weight="bold">
              {formatNumberForDisplay(data.hispanic)}
            </Text>
            <Text as="p" size="1" color="gray">
              Hispanic
            </Text>
          </Box>
        </Grid>
      </InfoCard>

      {data.viability && (
        <InfoCard title="Viability Analysis">
          <DataRow label="Level">{data.viability.level}</DataRow>
          <DataRow label="Score">{data.viability.score}</DataRow>
          <DataRow label="Seats">{data.viability.seats}</DataRow>
          <DataRow label="Candidates">{data.viability.candidates}</DataRow>
          <DataRow label="Candidates Per Seat">
            {data.viability.candidatesPerSeat}
          </DataRow>
          <Flex direction="column" gap="2" mt="2">
            <Flex justify="between" align="center">
              <Text size="2" color="gray">
                Partisan
              </Text>
              <Badge color={data.viability.isPartisan ? 'blue' : 'gray'}>
                {data.viability.isPartisan ? 'Yes' : 'No'}
              </Badge>
            </Flex>
            <Flex justify="between" align="center">
              <Text size="2" color="gray">
                Incumbent
              </Text>
              <Badge color={data.viability.isIncumbent ? 'green' : 'gray'}>
                {data.viability.isIncumbent ? 'Yes' : 'No'}
              </Badge>
            </Flex>
            <Flex justify="between" align="center">
              <Text size="2" color="gray">
                Uncontested
              </Text>
              <Badge color={data.viability.isUncontested ? 'amber' : 'gray'}>
                {data.viability.isUncontested ? 'Yes' : 'No'}
              </Badge>
            </Flex>
          </Flex>
        </InfoCard>
      )}
    </Grid>
  )
}
