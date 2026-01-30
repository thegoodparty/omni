'use client'

import { Grid, Text, Badge, Flex, Link } from '@radix-ui/themes'
import { formatDate } from '@/lib/utils/date'
import { useUser } from '../UserProvider'
import { InfoCard } from './InfoCard'
import { DataRow } from './DataRow'

function formatPhone(phone: string | null): string {
  if (!phone) return '—'
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`
  }
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`
  }
  return phone
}

export function UserBasicInfoSection() {
  const user = useUser()
  const { details, data } = user

  return (
    <Grid columns={{ initial: '1', md: '2' }} gap="4">
      <InfoCard title="Personal Information">
        <DataRow label="User ID">{user.userId}</DataRow>
        <DataRow label="Campaign ID">{user.id}</DataRow>
        <DataRow label="Slug">{user.slug}</DataRow>
        <DataRow label="Name">
          {`${details.firstName} ${details.lastName}`}
        </DataRow>
        <DataRow label="Date of Birth">{formatDate(details.dob)}</DataRow>
        <DataRow label="Phone">{formatPhone(details.phone)}</DataRow>
        <DataRow label="Campaign Phone">
          {formatPhone(details.campaignPhone)}
        </DataRow>
        <DataRow label="Website">
          {details.website ? (
            <Link href={details.website} target="_blank">
              {details.website}
            </Link>
          ) : (
            '—'
          )}
        </DataRow>
        <DataRow label="HubSpot ID">{data.hubspotId}</DataRow>
      </InfoCard>

      <InfoCard title="Location">
        <DataRow label="City">{details.city}</DataRow>
        <DataRow label="County">{details.county}</DataRow>
        <DataRow label="State">{details.state}</DataRow>
        <DataRow label="ZIP">{details.zip}</DataRow>
        <DataRow label="Geo Location">
          {details.geoLocation?.lat != null && details.geoLocation?.lng != null
            ? `${details.geoLocation.lat.toFixed(4)}, ${details.geoLocation.lng.toFixed(4)}`
            : '—'}
        </DataRow>
      </InfoCard>

      <InfoCard title="Account Status">
        <Flex direction="column" gap="3">
          <Flex justify="between" align="center">
            <Text size="2" color="gray">
              Active
            </Text>
            <Badge color={user.isActive ? 'green' : 'gray'}>
              {user.isActive ? 'Yes' : 'No'}
            </Badge>
          </Flex>
          <Flex justify="between" align="center">
            <Text size="2" color="gray">
              Verified
            </Text>
            <Badge color={user.isVerified ? 'blue' : 'orange'}>
              {user.isVerified ? 'Yes' : 'No'}
            </Badge>
          </Flex>
          <Flex justify="between" align="center">
            <Text size="2" color="gray">
              Pro
            </Text>
            <Badge color={user.isPro ? 'violet' : 'gray'}>
              {user.isPro ? 'Yes' : 'No'}
            </Badge>
          </Flex>
          <Flex justify="between" align="center">
            <Text size="2" color="gray">
              Demo Account
            </Text>
            <Badge color={user.isDemo ? 'amber' : 'gray'}>
              {user.isDemo ? 'Yes' : 'No'}
            </Badge>
          </Flex>
          <Flex justify="between" align="center">
            <Text size="2" color="gray">
              Won Election
            </Text>
            <Badge color={user.didWin ? 'green' : 'gray'}>
              {user.didWin ? 'Yes' : 'No'}
            </Badge>
          </Flex>
        </Flex>
      </InfoCard>

      <InfoCard title="Timeline">
        <DataRow label="Created">{formatDate(user.createdAt)}</DataRow>
        <DataRow label="Updated">{formatDate(user.updatedAt)}</DataRow>
        <DataRow label="Date Verified">
          {user.dateVerified ? formatDate(user.dateVerified) : 'Not verified'}
        </DataRow>
        <DataRow label="Last Visited">{formatDate(data.lastVisited)}</DataRow>
        <DataRow label="Last Step Date">{data.lastStepDate}</DataRow>
        <DataRow label="Current Step">{data.currentStep}</DataRow>
      </InfoCard>
    </Grid>
  )
}
