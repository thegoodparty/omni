'use client'

import { Grid, Text, Badge, Flex, Box } from '@radix-ui/themes'
import { InfoCard } from './InfoCard'
import { FieldList } from './FieldList'
import { DataRow } from './DataRow'
import type { CampaignData, CampaignDetails } from '@goodparty_org/sdk'
import type { EnrichedCampaign } from '@/app/dashboard/campaigns/actions'
import { formatDate } from '@/lib/utils/date'
import { buildDisplayFields } from '../campaign-fields'

interface DistrictView {
  l2Type: string
  l2Name: string
}

interface CampaignSectionProps {
  campaign: EnrichedCampaign
  district?: DistrictView | null
}

function fmtNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return value.toLocaleString()
}

const STATUS_FLAGS = buildDisplayFields([
  'isActive',
  'isVerified',
  'isPro',
  'isDemo',
  'didWin',
  'canDownloadFederal',
])

const TIER_FIELDS = buildDisplayFields(['tier'])

const CAMPAIGN_DATA_FIELDS = buildDisplayFields([
  'data.name',
  'slug',
  'data.launchStatus',
])

const TIMELINE_FIELDS = buildDisplayFields([
  'createdAt',
  'updatedAt',
  'dateVerified',
  'data.lastVisited',
  'data.lastStepDate',
  'data.currentStep',
])

const LOCATION_FIELDS = buildDisplayFields([
  'details.state',
  'details.city',
  'details.county',
  'details.zip',
])

const OFFICE_FIELDS = buildDisplayFields([
  'details.ballotLevel',
  'details.level',
  'details.officeTermLength',
])

const ELECTION_FIELDS = buildDisplayFields([
  'details.electionDate',
  'details.partisanType',
])

const FILING_PERIOD_FIELDS = buildDisplayFields([
  'details.filingPeriodsStart',
  'details.filingPeriodsEnd',
])

const PARTY_BACKGROUND_FIELDS = buildDisplayFields([
  'details.party',
  'details.occupation',
  'details.website',
  'details.pledged',
])

export function CampaignSection({ campaign, district }: CampaignSectionProps) {
  const data: NonNullable<CampaignData> = campaign.data ?? {}
  const details: NonNullable<CampaignDetails> = campaign.details ?? {}
  const metrics = campaign.raceTargetMetrics ?? null
  const positionName = campaign.positionName ?? null

  return (
    <Flex direction="column" gap="6">
      <Grid columns={{ initial: '1', md: '2' }} gap="4">
        <InfoCard title="Campaign Status">
          <Flex direction="column" gap="3">
            <FieldList data={campaign} fields={STATUS_FLAGS} />
          </Flex>
        </InfoCard>

        <InfoCard title="Election Results (Campaign Tier)">
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
        <InfoCard title="District">
          <DataRow label="District Type">
            {district?.l2Type ? district.l2Type.replace(/_/g, ' ') : '—'}
          </DataRow>
          <DataRow label="District Name">{district?.l2Name ?? '—'}</DataRow>
        </InfoCard>

        <InfoCard title="Race Targets">
          <DataRow label="Election Date">
            {details.electionDate ? formatDate(details.electionDate) : '—'}
          </DataRow>
          {metrics ? (
            <>
              <DataRow label="Projected Turnout">
                {fmtNumber(metrics.projectedTurnout)}
              </DataRow>
              <DataRow label="Win Number">
                {fmtNumber(metrics.winNumber)}
              </DataRow>
              <DataRow label="Voter Contact Goal">
                {fmtNumber(metrics.voterContactGoal)}
              </DataRow>
            </>
          ) : (
            <Text size="2" color="gray">
              Set an election date and a district/position on this campaign to
              compute live race targets.
            </Text>
          )}
        </InfoCard>

        <InfoCard title="Location">
          <FieldList data={campaign} fields={LOCATION_FIELDS} />
        </InfoCard>

        <InfoCard title="Office">
          <DataRow label="Position">{positionName ?? '—'}</DataRow>
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
