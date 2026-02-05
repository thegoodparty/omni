'use client'

import { Grid, Text, Badge, Flex, Box, Table } from '@radix-ui/themes'
import { formatDate } from '@/lib/utils/date'
import { LAUNCH_STATUS } from '../constants'
import { InfoCard } from './InfoCard'
import { DataRow } from './DataRow'
import type { Campaign } from '../types'
import { CAMPAIGN_PLAN_STATUS } from '@/types/campaign'

interface CampaignSectionProps {
  campaign: Campaign
}

type StatusFlagKey =
  | 'isActive'
  | 'isVerified'
  | 'isPro'
  | 'isDemo'
  | 'didWin'
  | 'canDownloadFederal'

interface StatusFlag {
  key: StatusFlagKey
  label: string
  trueColor: 'green' | 'blue' | 'violet' | 'amber'
}

const STATUS_FLAGS: StatusFlag[] = [
  { key: 'isActive', label: 'Active', trueColor: 'green' },
  { key: 'isVerified', label: 'Verified', trueColor: 'blue' },
  { key: 'isPro', label: 'Pro', trueColor: 'violet' },
  { key: 'isDemo', label: 'Demo Account', trueColor: 'amber' },
  { key: 'didWin', label: 'Won Election', trueColor: 'green' },
  {
    key: 'canDownloadFederal',
    label: 'Can Download Federal',
    trueColor: 'green',
  },
]

export function CampaignSection({ campaign }: CampaignSectionProps) {
  const { data, details } = campaign

  return (
    <Flex direction="column" gap="6">
      <Grid columns={{ initial: '1', md: '2' }} gap="4">
        <InfoCard title="Campaign Status">
          <Flex direction="column" gap="3">
            {STATUS_FLAGS.map(({ key, label, trueColor }) => {
              const value = campaign[key]
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
              {campaign.tier ?? 'None'}
            </Badge>
          </DataRow>
        </InfoCard>

        <InfoCard title="Campaign Data">
          <DataRow label="Campaign Name">{data.name}</DataRow>
          <DataRow label="Slug">{campaign.slug}</DataRow>
          <DataRow label="Launch Status">
            <Badge
              color={
                data.launchStatus === LAUNCH_STATUS.LAUNCHED
                  ? 'green'
                  : 'orange'
              }
              variant="soft"
            >
              {data.launchStatus || LAUNCH_STATUS.NOT_LAUNCHED}
            </Badge>
          </DataRow>
        </InfoCard>

        <InfoCard title="Timeline">
          <DataRow label="Created">{formatDate(campaign.createdAt)}</DataRow>
          <DataRow label="Updated">{formatDate(campaign.updatedAt)}</DataRow>
          <DataRow label="Date Verified">
            {campaign.dateVerified
              ? formatDate(campaign.dateVerified)
              : 'Not verified'}
          </DataRow>
          <DataRow label="Last Visited">{formatDate(data.lastVisited)}</DataRow>
          <DataRow label="Last Step Date">{data.lastStepDate}</DataRow>
          <DataRow label="Current Step">{data.currentStep}</DataRow>
        </InfoCard>
      </Grid>

      <Grid columns={{ initial: '1', md: '2' }} gap="4">
        <InfoCard title="Location">
          <DataRow label="State">{details.state}</DataRow>
          <DataRow label="City">{details.city}</DataRow>
          <DataRow label="County">{details.county}</DataRow>
          <DataRow label="ZIP">{details.zip}</DataRow>
        </InfoCard>

        <InfoCard title="Office">
          <DataRow label="Office">{details.office}</DataRow>
          <DataRow label="Other Office">{details.otherOffice}</DataRow>
          <DataRow label="Ballot Level">
            <Badge color="blue" variant="soft">
              {details.ballotLevel ?? 'Not set'}
            </Badge>
          </DataRow>
          <DataRow label="Election Level">
            <Badge color="iris" variant="soft">
              {details.level ?? 'Not set'}
            </Badge>
          </DataRow>
          <DataRow label="Term Length">{details.officeTermLength}</DataRow>
        </InfoCard>

        <InfoCard title="Election">
          <DataRow label="Election Date">{details.electionDate}</DataRow>
          <DataRow label="Partisan Type">{details.partisanType}</DataRow>
          <DataRow label="Has Primary">
            <Badge color={details.hasPrimary ? 'green' : 'gray'} variant="soft">
              {details.hasPrimary ? 'Yes' : 'No'}
            </Badge>
          </DataRow>
        </InfoCard>

        <InfoCard title="Filing Period">
          <DataRow label="Start">{details.filingPeriodsStart}</DataRow>
          <DataRow label="End">{details.filingPeriodsEnd}</DataRow>
        </InfoCard>

        <InfoCard title="Party & Background">
          <DataRow label="Party">{details.party}</DataRow>
          <DataRow label="Occupation">{details.occupation}</DataRow>
          <DataRow label="Website">{details.website}</DataRow>
          <DataRow label="Pledged">
            <Badge color={details.pledged ? 'green' : 'gray'} variant="soft">
              {details.pledged ? 'Yes' : 'No'}
            </Badge>
          </DataRow>
        </InfoCard>

        {details.funFact && (
          <InfoCard title="Fun Fact">
            <Text size="2">{details.funFact}</Text>
          </InfoCard>
        )}
      </Grid>

      {details.topIssues?.positions &&
        details.topIssues.positions.length > 0 && (
          <InfoCard title="Top Issues">
            <Flex direction="column" gap="4">
              {details.topIssues.positions.map((position) => (
                <Box
                  key={position.id}
                  p="3"
                  className="bg-[var(--gray-2)] rounded-md"
                >
                  <Flex direction="column" gap="1">
                    <Flex gap="2" align="center">
                      <Badge color="blue">{position.topIssue.name}</Badge>
                      <Text size="2" weight="medium">
                        {position.name}
                      </Text>
                    </Flex>
                    {details.topIssues?.[`position-${position.id}`] && (
                      <Text size="2" color="gray">
                        {String(details.topIssues[`position-${position.id}`])}
                      </Text>
                    )}
                  </Flex>
                </Box>
              ))}
            </Flex>
          </InfoCard>
        )}

      {details.customIssues && details.customIssues.length > 0 && (
        <InfoCard title="Custom Issues">
          <Flex direction="column" gap="3">
            {details.customIssues.map((issue, index) => (
              <Box key={index} p="3" className="bg-[var(--gray-2)] rounded-md">
                <Text size="2" weight="medium">
                  {issue.title}
                </Text>
                <Text size="2" color="gray">
                  {issue.position}
                </Text>
              </Box>
            ))}
          </Flex>
        </InfoCard>
      )}

      {data.campaignPlanStatus && (
        <InfoCard title="Campaign Plan Status">
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Plan Item</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {Object.entries(data.campaignPlanStatus).map(([key, value]) => (
                <Table.Row key={key}>
                  <Table.Cell>
                    <Text size="2" style={{ textTransform: 'capitalize' }}>
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge
                      color={
                        value.status === CAMPAIGN_PLAN_STATUS.COMPLETED
                          ? 'green'
                          : value.status === CAMPAIGN_PLAN_STATUS.FAILED
                            ? 'red'
                            : 'orange'
                      }
                      variant="soft"
                    >
                      {value.status}
                    </Badge>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </InfoCard>
      )}

      {data.customVoterFiles && data.customVoterFiles.length > 0 && (
        <InfoCard title="Custom Voter Files">
          <Flex direction="column" gap="3">
            {data.customVoterFiles.map((file, index) => (
              <Box
                key={index}
                p="3"
                className="border border-[var(--gray-5)] rounded-md"
              >
                <Flex justify="between" align="start" mb="2">
                  <Text size="2" weight="medium">
                    {file.name}
                  </Text>
                  <Badge color="blue" variant="soft">
                    {file.channel}
                  </Badge>
                </Flex>
                <Flex gap="2" wrap="wrap" mb="2">
                  <Badge color="iris" variant="soft">
                    {file.purpose}
                  </Badge>
                </Flex>
                <Text size="1" color="gray">
                  Created: {file.createdAt}
                </Text>
              </Box>
            ))}
          </Flex>
        </InfoCard>
      )}
    </Flex>
  )
}
