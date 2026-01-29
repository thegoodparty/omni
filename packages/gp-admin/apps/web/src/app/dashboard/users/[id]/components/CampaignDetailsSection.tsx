import { Grid, Text, Badge, Flex, Box, Heading } from '@radix-ui/themes'
import { formatDate } from '@/lib/utils/date'
import { InfoCard } from './InfoCard'
import { DataRow } from './DataRow'
import type { DetailedUser } from '../types'

interface CampaignDetailsSectionProps {
  user: DetailedUser
}

export function CampaignDetailsSection({ user }: CampaignDetailsSectionProps) {
  const { details, data } = user

  return (
    <Grid columns={{ initial: '1', md: '2' }} gap="4">
      <InfoCard title="Office & Election">
        <DataRow label="Office" value={details.otherOffice || details.office} />
        <DataRow label="Ballot Level" value={details.ballotLevel} />
        <DataRow label="Partisan Type" value={details.partisanType} />
        <DataRow
          label="Election Date"
          value={formatDate(details.electionDate)}
        />
        <DataRow label="Term Length" value={details.officeTermLength} />
        <DataRow
          label="Has Primary"
          value={
            <Badge color={details.hasPrimary ? 'blue' : 'gray'}>
              {details.hasPrimary ? 'Yes' : 'No'}
            </Badge>
          }
        />
        <DataRow
          label="Filing Period"
          value={`${formatDate(details.filingPeriodsStart)} - ${formatDate(details.filingPeriodsEnd)}`}
        />
      </InfoCard>

      <InfoCard title="Campaign Status">
        <DataRow label="Launch Status" value={data.launchStatus} />
        <DataRow label="Has Voter File" value={data.hasVoterFile} />
        <DataRow label="P2V Status" value={data.path_to_victory_status} />
        <DataRow label="Text Campaigns" value={data.textCampaignCount} />
        <DataRow
          label="Can Download Federal"
          value={
            <Badge color={user.canDownloadFederal ? 'green' : 'gray'}>
              {user.canDownloadFederal ? 'Yes' : 'No'}
            </Badge>
          }
        />
        <DataRow label="Completed Tasks" value={user.completedTaskIds.length} />
      </InfoCard>

      <InfoCard title="Candidate Background">
        <DataRow
          label="Citizen"
          value={details.citizen === 'yes' ? 'Yes' : 'No'}
        />
        <DataRow
          label="Run Before"
          value={details.runBefore === 'yes' ? 'Yes' : 'No'}
        />
        <DataRow
          label="Know Run"
          value={details.knowRun === 'yes' ? 'Yes' : 'No'}
        />
        <DataRow
          label="Filed Statement"
          value={details.filedStatement === 'yes' ? 'Yes' : 'No'}
        />
        <DataRow
          label="Pledged"
          value={
            <Badge color={details.pledged ? 'green' : 'gray'}>
              {details.pledged ? 'Yes' : 'No'}
            </Badge>
          }
        />
        <DataRow label="Past Experience" value={details.pastExperience} />
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
