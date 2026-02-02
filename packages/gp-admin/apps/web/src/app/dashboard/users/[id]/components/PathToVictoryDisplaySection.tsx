'use client'

import { Grid, Text, Box, Flex, Progress, Badge } from '@radix-ui/themes'
import { useUser } from '../UserProvider'
import { InfoCard } from './InfoCard'
import { DataRow } from './DataRow'
import { formatNumberForDisplay } from '@/lib/utils/number'

export function PathToVictoryDisplaySection() {
  const user = useUser()
  const p2v = user.pathToVictory?.data
  if (!p2v) {
    return (
      <InfoCard title="Path to Victory">
        <Text size="2" color="gray">
          No Path to Victory data available.
        </Text>
      </InfoCard>
    )
  }

  const totalRegistered = p2v.totalRegisteredVoters || 0
  const winNumber =
    typeof p2v.winNumber === 'string'
      ? parseFloat(p2v.winNumber)
      : p2v.winNumber || 0
  const winPercentage =
    totalRegistered > 0 ? (winNumber / totalRegistered) * 100 : 0

  return (
    <Grid columns={{ initial: '1', md: '2' }} gap="4">
      <InfoCard title="P2V Status">
        <DataRow label="Status">
          <Badge
            color={p2v.p2vStatus === 'Complete' ? 'green' : 'orange'}
            variant="soft"
          >
            {p2v.p2vStatus || 'Not set'}
          </Badge>
        </DataRow>
        <DataRow label="Election Type">{p2v.electionType}</DataRow>
        <DataRow label="Election Location">{p2v.electionLocation}</DataRow>
        <DataRow label="Source">{p2v.source}</DataRow>
        <DataRow label="P2V Complete Date">{p2v.p2vCompleteDate}</DataRow>
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
            {formatNumberForDisplay(p2v.voterContactGoal)}
          </DataRow>
          <DataRow label="Total Registered Voters">
            {formatNumberForDisplay(p2v.totalRegisteredVoters)}
          </DataRow>
          <DataRow label="Projected Turnout">
            {formatNumberForDisplay(p2v.projectedTurnout)}
          </DataRow>
          <DataRow label="Average Turnout">
            {formatNumberForDisplay(p2v.averageTurnout)}
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
                {formatNumberForDisplay(p2v.republicans)}
              </Text>
            </Flex>
            <Progress
              value={
                totalRegistered > 0
                  ? ((p2v.republicans || 0) / totalRegistered) * 100
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
                {formatNumberForDisplay(p2v.democrats)}
              </Text>
            </Flex>
            <Progress
              value={
                totalRegistered > 0
                  ? ((p2v.democrats || 0) / totalRegistered) * 100
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
                {formatNumberForDisplay(p2v.indies)}
              </Text>
            </Flex>
            <Progress
              value={
                totalRegistered > 0
                  ? ((p2v.indies || 0) / totalRegistered) * 100
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
              {formatNumberForDisplay(p2v.men)}
            </Text>
            <Text as="p" size="1" color="gray">
              Men
            </Text>
          </Box>
          <Box p="3" className="bg-[var(--gray-2)] rounded-md text-center">
            <Text as="p" size="4" weight="bold">
              {formatNumberForDisplay(p2v.women)}
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
              {formatNumberForDisplay(p2v.white)}
            </Text>
            <Text as="p" size="1" color="gray">
              White
            </Text>
          </Box>
          <Box p="3" className="bg-[var(--gray-2)] rounded-md text-center">
            <Text as="p" size="4" weight="bold">
              {formatNumberForDisplay(p2v.asian)}
            </Text>
            <Text as="p" size="1" color="gray">
              Asian
            </Text>
          </Box>
          <Box p="3" className="bg-[var(--gray-2)] rounded-md text-center">
            <Text as="p" size="4" weight="bold">
              {formatNumberForDisplay(p2v.africanAmerican)}
            </Text>
            <Text as="p" size="1" color="gray">
              African American
            </Text>
          </Box>
          <Box p="3" className="bg-[var(--gray-2)] rounded-md text-center">
            <Text as="p" size="4" weight="bold">
              {formatNumberForDisplay(p2v.hispanic)}
            </Text>
            <Text as="p" size="1" color="gray">
              Hispanic
            </Text>
          </Box>
        </Grid>
      </InfoCard>

      {p2v.viability && (
        <InfoCard title="Viability Analysis">
          <DataRow label="Level">{p2v.viability.level}</DataRow>
          <DataRow label="Score">{p2v.viability.score}</DataRow>
          <DataRow label="Seats">{p2v.viability.seats}</DataRow>
          <DataRow label="Candidates">{p2v.viability.candidates}</DataRow>
          <DataRow label="Candidates Per Seat">
            {p2v.viability.candidatesPerSeat}
          </DataRow>
          <Flex direction="column" gap="2" mt="2">
            <Flex justify="between" align="center">
              <Text size="2" color="gray">
                Partisan
              </Text>
              <Badge color={p2v.viability.isPartisan ? 'blue' : 'gray'}>
                {p2v.viability.isPartisan ? 'Yes' : 'No'}
              </Badge>
            </Flex>
            <Flex justify="between" align="center">
              <Text size="2" color="gray">
                Incumbent
              </Text>
              <Badge
                color={p2v.viability.isIncumbent === 'true' ? 'green' : 'gray'}
              >
                {p2v.viability.isIncumbent === 'true' ? 'Yes' : 'No'}
              </Badge>
            </Flex>
            <Flex justify="between" align="center">
              <Text size="2" color="gray">
                Uncontested
              </Text>
              <Badge
                color={
                  p2v.viability.isUncontested === 'true' ? 'amber' : 'gray'
                }
              >
                {p2v.viability.isUncontested === 'true' ? 'Yes' : 'No'}
              </Badge>
            </Flex>
          </Flex>
        </InfoCard>
      )}
    </Grid>
  )
}
