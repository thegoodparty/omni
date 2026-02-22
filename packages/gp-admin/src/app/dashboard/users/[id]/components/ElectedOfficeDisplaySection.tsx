'use client'

import { Grid, Text, Badge, Flex, Callout } from '@radix-ui/themes'
import { HiInformationCircle } from 'react-icons/hi'
import { formatDate } from '@/lib/utils/date'
import { InfoCard } from './InfoCard'
import { DataRow } from './DataRow'
import type { ElectedOffice } from '@goodparty_org/sdk'

interface ElectedOfficeDisplaySectionProps {
  electedOffice: ElectedOffice | null
}

export function ElectedOfficeDisplaySection({
  electedOffice,
}: ElectedOfficeDisplaySectionProps) {
  if (!electedOffice) {
    return (
      <Callout.Root color="gray">
        <Callout.Icon>
          <HiInformationCircle />
        </Callout.Icon>
        <Callout.Text>
          No elected office record exists. This section becomes available when
          the candidate wins their election.
        </Callout.Text>
      </Callout.Root>
    )
  }

  return (
    <Grid columns={{ initial: '1', md: '2' }} gap="4">
      <InfoCard title="Term Dates">
        <DataRow label="Elected Date">
          {formatDate(electedOffice.electedDate)}
        </DataRow>
        <DataRow label="Sworn In Date">
          {formatDate(electedOffice.swornInDate)}
        </DataRow>
        <DataRow label="Term Start Date">
          {formatDate(electedOffice.termStartDate)}
        </DataRow>
        <DataRow label="Term End Date">
          {formatDate(electedOffice.termEndDate)}
        </DataRow>
        <DataRow label="Term Length">
          {electedOffice.termLengthDays
            ? `${electedOffice.termLengthDays} days`
            : '—'}
        </DataRow>
      </InfoCard>

      <InfoCard title="Status">
        <Flex justify="between" align="center">
          <Text size="2" color="gray">
            Active Office Holder
          </Text>
          <Badge color={electedOffice.isActive ? 'green' : 'gray'}>
            {electedOffice.isActive ? 'Yes' : 'No'}
          </Badge>
        </Flex>
      </InfoCard>

      <InfoCard title="IDs">
        <DataRow label="Record ID">{electedOffice.id}</DataRow>
        <DataRow label="User ID">{electedOffice.userId}</DataRow>
        <DataRow label="Campaign ID">{electedOffice.campaignId}</DataRow>
      </InfoCard>

      <InfoCard title="Timestamps">
        <DataRow label="Created">{formatDate(electedOffice.createdAt)}</DataRow>
        <DataRow label="Updated">{formatDate(electedOffice.updatedAt)}</DataRow>
      </InfoCard>
    </Grid>
  )
}
