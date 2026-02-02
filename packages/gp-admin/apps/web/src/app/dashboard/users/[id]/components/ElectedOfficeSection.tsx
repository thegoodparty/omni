'use client'

import { Grid, Text, Badge, Flex, Callout } from '@radix-ui/themes'
import { HiInformationCircle } from 'react-icons/hi'
import { formatDate } from '@/lib/utils/date'
import { useUser } from '../UserProvider'
import { InfoCard } from './InfoCard'
import { DataRow } from './DataRow'

export function ElectedOfficeSection() {
  const user = useUser()

  // Check if user has elected office (based on didWin flag)
  const hasElectedOffice = user.didWin === true

  if (!hasElectedOffice) {
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

  // Elected office data would come from ElectedOffice model
  // For now, we display placeholder structure
  const electedOffice = {
    electedDate: null,
    swornInDate: null,
    termStartDate: null,
    termLengthDays: null,
    termEndDate: null,
    isActive: true,
  }

  return (
    <Grid columns={{ initial: '1', md: '2' }} gap="4">
      <InfoCard title="Term Dates">
        <DataRow label="Elected Date">
          {electedOffice.electedDate
            ? formatDate(electedOffice.electedDate)
            : '—'}
        </DataRow>
        <DataRow label="Sworn In Date">
          {electedOffice.swornInDate
            ? formatDate(electedOffice.swornInDate)
            : '—'}
        </DataRow>
        <DataRow label="Term Start Date">
          {electedOffice.termStartDate
            ? formatDate(electedOffice.termStartDate)
            : '—'}
        </DataRow>
        <DataRow label="Term End Date">
          {electedOffice.termEndDate
            ? formatDate(electedOffice.termEndDate)
            : '—'}
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
    </Grid>
  )
}
