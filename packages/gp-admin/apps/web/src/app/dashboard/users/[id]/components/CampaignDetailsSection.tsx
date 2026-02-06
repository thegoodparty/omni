'use client'

import { Grid, Text, Badge, Flex, Box, Heading } from '@radix-ui/themes'
import { formatDate } from '@/lib/utils/date'
import { useUser } from '../UserProvider'
import { InfoCard } from './InfoCard'
import { DataRow } from './DataRow'

export function CampaignDetailsSection() {
  const user = useUser()
  const { details, data } = user

  return (
    <Grid columns={{ initial: '1', md: '2' }} gap="4">
      <InfoCard title="Office & Election">
        <DataRow label="Office">
          {details.otherOffice || details.office}
        </DataRow>
        <DataRow label="Ballot Level">{details.ballotLevel}</DataRow>
        <DataRow label="Partisan Type">{details.partisanType}</DataRow>
        <DataRow label="Election Date">
          {formatDate(details.electionDate)}
        </DataRow>
        <DataRow label="Term Length">{details.officeTermLength}</DataRow>
        <DataRow label="Has Primary">
          <Badge color={details.hasPrimary ? 'blue' : 'gray'}>
            {details.hasPrimary ? 'Yes' : 'No'}
          </Badge>
        </DataRow>
        <DataRow label="Filing Period">
          {`${formatDate(details.filingPeriodsStart)} - ${formatDate(details.filingPeriodsEnd)}`}
        </DataRow>
      </InfoCard>

      <InfoCard title="Campaign Status">
        <DataRow label="Launch Status">{data.launchStatus}</DataRow>
        <DataRow label="Has Voter File">{data.hasVoterFile}</DataRow>
        <DataRow label="P2V Status">{data.path_to_victory_status}</DataRow>
        <DataRow label="Text Campaigns">{data.textCampaignCount}</DataRow>
        <DataRow label="Can Download Federal">
          <Badge color={user.canDownloadFederal ? 'green' : 'gray'}>
            {user.canDownloadFederal ? 'Yes' : 'No'}
          </Badge>
        </DataRow>
        <DataRow label="Completed Tasks">
          {user.completedTaskIds.length}
        </DataRow>
      </InfoCard>

      <InfoCard title="Candidate Background">
        <DataRow label="Citizen">
          {details.citizen === 'yes' ? 'Yes' : 'No'}
        </DataRow>
        <DataRow label="Run Before">
          {details.runBefore === 'yes' ? 'Yes' : 'No'}
        </DataRow>
        <DataRow label="Know Run">
          {details.knowRun === 'yes' ? 'Yes' : 'No'}
        </DataRow>
        <DataRow label="Filed Statement">
          {details.filedStatement === 'yes' ? 'Yes' : 'No'}
        </DataRow>
        <DataRow label="Pledged">
          <Badge color={details.pledged ? 'green' : 'gray'}>
            {details.pledged ? 'Yes' : 'No'}
          </Badge>
        </DataRow>
        <DataRow label="Past Experience">{details.pastExperience}</DataRow>
      </InfoCard>

      <InfoCard title="Onboarding Progress">
        <Flex direction="column" gap="3">
          <Flex justify="between" align="center">
            <Text size="2" color="gray">
              Profile
            </Text>
            <Badge color={data.profile?.completed ? 'green' : 'orange'}>
              {data.profile?.completed ? 'Complete' : 'Incomplete'}
            </Badge>
          </Flex>
          <Flex justify="between" align="center">
            <Text size="2" color="gray">
              Team
            </Text>
            <Badge color={data.team?.completed ? 'green' : 'orange'}>
              {data.team?.completed ? 'Complete' : 'Incomplete'}
            </Badge>
          </Flex>
          <Flex justify="between" align="center">
            <Text size="2" color="gray">
              Social
            </Text>
            <Badge color={data.social?.completed ? 'green' : 'orange'}>
              {data.social?.completed ? 'Complete' : 'Incomplete'}
            </Badge>
          </Flex>
          <Box>
            <Text size="2" color="gray" mb="2">
              Finance
            </Text>
            <Flex gap="2" wrap="wrap" mt="1">
              {data.finance &&
                Object.entries(data.finance).map(([key, value]) => (
                  <Badge
                    key={key}
                    color={value ? 'green' : 'gray'}
                    variant="soft"
                    size="1"
                  >
                    {key}
                  </Badge>
                ))}
            </Flex>
          </Box>
          <Box>
            <Text size="2" color="gray" mb="2">
              Launch
            </Text>
            <Flex gap="2" wrap="wrap" mt="1">
              {data.launch &&
                Object.entries(data.launch).map(([key, value]) => (
                  <Badge
                    key={key}
                    color={value ? 'green' : 'gray'}
                    variant="soft"
                    size="1"
                  >
                    {key}
                  </Badge>
                ))}
            </Flex>
          </Box>
        </Flex>
      </InfoCard>

      {details.runningAgainst && details.runningAgainst.length > 0 && (
        <InfoCard title="Opponents">
          <Flex direction="column" gap="3">
            {details.runningAgainst.map((opponent, index) => (
              <Box key={index} p="3" className="bg-[var(--gray-2)] rounded-md">
                <Heading size="2" mb="1">
                  {opponent.name}
                </Heading>
                <Badge color="red" variant="soft" mb="2">
                  {opponent.party}
                </Badge>
                <Text as="p" size="2" color="gray">
                  {opponent.description}
                </Text>
              </Box>
            ))}
          </Flex>
        </InfoCard>
      )}

      {details.funFact && (
        <InfoCard title="Fun Fact">
          <Text as="p" size="2" style={{ lineHeight: 1.6 }}>
            {details.funFact}
          </Text>
        </InfoCard>
      )}
    </Grid>
  )
}
