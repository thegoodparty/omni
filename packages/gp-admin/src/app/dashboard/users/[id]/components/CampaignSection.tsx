'use client'

import { Grid, Text, Badge, Flex, Box } from '@radix-ui/themes'
import { LAUNCH_STATUS } from '../constants'
import { InfoCard } from './InfoCard'
import { FieldList } from './FieldList'
import type {
  Campaign,
  CampaignData,
  CampaignDetails,
} from '@goodparty_org/sdk'
import type { FieldConfig } from '../types/field-config'

interface CampaignSectionProps {
  campaign: Campaign
}

const STATUS_FLAGS: FieldConfig[] = [
  {
    key: 'isActive',
    label: 'Active',
    type: 'boolean',
    trueBadgeColor: 'green',
  },
  {
    key: 'isVerified',
    label: 'Verified',
    type: 'boolean',
    trueBadgeColor: 'blue',
  },
  { key: 'isPro', label: 'Pro', type: 'boolean', trueBadgeColor: 'violet' },
  {
    key: 'isDemo',
    label: 'Demo Account',
    type: 'boolean',
    trueBadgeColor: 'amber',
  },
  {
    key: 'didWin',
    label: 'Won Election',
    type: 'boolean',
    trueBadgeColor: 'green',
  },
  {
    key: 'canDownloadFederal',
    label: 'Can Download Federal',
    type: 'boolean',
    trueBadgeColor: 'green',
  },
]

const TIER_FIELDS: FieldConfig[] = [
  {
    key: 'tier',
    label: 'Tier',
    type: 'badge',
    badgeColor: 'blue',
    fallback: 'None',
  },
]

const CAMPAIGN_DATA_FIELDS: FieldConfig[] = [
  { key: 'data.name', label: 'Campaign Name', type: 'text' },
  { key: 'slug', label: 'Slug', type: 'text' },
  {
    key: 'data.launchStatus',
    label: 'Launch Status',
    type: 'badge',
    colorMap: { [LAUNCH_STATUS.LAUNCHED]: 'green' },
    defaultColor: 'orange',
    fallback: LAUNCH_STATUS.NOT_LAUNCHED,
  },
]

const TIMELINE_FIELDS: FieldConfig[] = [
  { key: 'createdAt', label: 'Created', type: 'date' },
  { key: 'updatedAt', label: 'Updated', type: 'date' },
  {
    key: 'dateVerified',
    label: 'Date Verified',
    type: 'date',
    fallback: 'Not verified',
  },
  { key: 'data.lastVisited', label: 'Last Visited', type: 'date' },
  { key: 'data.lastStepDate', label: 'Last Step Date', type: 'text' },
  { key: 'data.currentStep', label: 'Current Step', type: 'text' },
]

const LOCATION_FIELDS: FieldConfig[] = [
  { key: 'details.state', label: 'State', type: 'text' },
  { key: 'details.city', label: 'City', type: 'text' },
  { key: 'details.county', label: 'County', type: 'text' },
  { key: 'details.zip', label: 'ZIP', type: 'text' },
]

const OFFICE_FIELDS: FieldConfig[] = [
  { key: 'details.office', label: 'Office', type: 'text' },
  { key: 'details.otherOffice', label: 'Other Office', type: 'text' },
  {
    key: 'details.ballotLevel',
    label: 'Ballot Level',
    type: 'badge',
    badgeColor: 'blue',
    fallback: 'Not set',
  },
  {
    key: 'details.level',
    label: 'Election Level',
    type: 'badge',
    badgeColor: 'iris',
    fallback: 'Not set',
  },
  { key: 'details.officeTermLength', label: 'Term Length', type: 'text' },
]

const ELECTION_FIELDS: FieldConfig[] = [
  { key: 'details.electionDate', label: 'Election Date', type: 'text' },
  { key: 'details.partisanType', label: 'Partisan Type', type: 'text' },
  {
    key: 'details.hasPrimary',
    label: 'Has Primary',
    type: 'boolean',
    trueBadgeColor: 'green',
  },
]

const FILING_PERIOD_FIELDS: FieldConfig[] = [
  { key: 'details.filingPeriodsStart', label: 'Start', type: 'text' },
  { key: 'details.filingPeriodsEnd', label: 'End', type: 'text' },
]

const PARTY_BACKGROUND_FIELDS: FieldConfig[] = [
  { key: 'details.party', label: 'Party', type: 'text' },
  { key: 'details.occupation', label: 'Occupation', type: 'text' },
  { key: 'details.website', label: 'Website', type: 'text' },
  {
    key: 'details.pledged',
    label: 'Pledged',
    type: 'boolean',
    trueBadgeColor: 'green',
  },
]

export function CampaignSection({ campaign }: CampaignSectionProps) {
  const data: NonNullable<CampaignData> = campaign.data ?? {}
  const details: NonNullable<CampaignDetails> = campaign.details ?? {}

  return (
    <Flex direction="column" gap="6">
      <Grid columns={{ initial: '1', md: '2' }} gap="4">
        <InfoCard title="Campaign Status">
          <Flex direction="column" gap="3">
            <FieldList data={campaign} fields={STATUS_FLAGS} />
          </Flex>
        </InfoCard>

        <InfoCard title="Campaign Tier">
          <FieldList data={campaign} fields={TIER_FIELDS} />
        </InfoCard>

        <InfoCard title="Campaign Data">
          <FieldList data={campaign} fields={CAMPAIGN_DATA_FIELDS} />
        </InfoCard>

        <InfoCard title="Timeline">
          <FieldList data={campaign} fields={TIMELINE_FIELDS} />
        </InfoCard>
      </Grid>

      <Grid columns={{ initial: '1', md: '2' }} gap="4">
        <InfoCard title="Location">
          <FieldList data={campaign} fields={LOCATION_FIELDS} />
        </InfoCard>

        <InfoCard title="Office">
          <FieldList data={campaign} fields={OFFICE_FIELDS} />
        </InfoCard>

        <InfoCard title="Election">
          <FieldList data={campaign} fields={ELECTION_FIELDS} />
        </InfoCard>

        <InfoCard title="Filing Period">
          <FieldList data={campaign} fields={FILING_PERIOD_FIELDS} />
        </InfoCard>

        <InfoCard title="Party & Background">
          <FieldList data={campaign} fields={PARTY_BACKGROUND_FIELDS} />
        </InfoCard>

        {details.funFact && (
          <InfoCard title="Fun Fact">
            <Text size="2">{details.funFact}</Text>
          </InfoCard>
        )}
      </Grid>

      {details.customIssues && details.customIssues.length > 0 && (
        <InfoCard title="Custom Issues">
          <Flex direction="column" gap="3">
            {details.customIssues.map((issue, index) => (
              <Box key={index} p="3" className="bg-[var(--gray-2)] rounded-md">
                <Text size="2" weight="medium">
                  {issue.title}
                </Text>
                <Text size="2" color="gray" ml="2">
                  {issue.position}
                </Text>
              </Box>
            ))}
          </Flex>
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
