'use client'

import { Grid, Badge, Flex } from '@radix-ui/themes'
import { formatPhone } from '@/lib/utils/phone'
import { useUser } from '../UserProvider'
import { InfoCard } from './InfoCard'
import { DataRow } from './DataRow'

export function UserInfoSection() {
  const user = useUser()
  const { details, data } = user

  return (
    <Grid columns={{ initial: '1', md: '2' }} gap="4">
      <InfoCard title="Personal Information">
        <DataRow label="User ID">{user.userId}</DataRow>
        <DataRow label="Campaign ID">{user.id}</DataRow>
        <DataRow label="Slug">{user.slug}</DataRow>
        <DataRow label="First Name">{details.firstName}</DataRow>
        <DataRow label="Last Name">{details.lastName}</DataRow>
        <DataRow label="Display Name">{data.name}</DataRow>
        <DataRow label="Phone">{formatPhone(details.phone)}</DataRow>
        <DataRow label="ZIP">{details.zip}</DataRow>
      </InfoCard>

      <InfoCard title="Metadata">
        <DataRow label="HubSpot ID">{data.hubspotId}</DataRow>
        <DataRow label="Text Notifications">
          <Badge color="gray" variant="soft">
            {/* Would come from metaData */}
            Unknown
          </Badge>
        </DataRow>
      </InfoCard>

      <InfoCard title="Roles">
        <Flex gap="2" wrap="wrap">
          {/* Roles would come from User model */}
          <Badge color="blue" variant="soft">
            candidate
          </Badge>
        </Flex>
      </InfoCard>
    </Grid>
  )
}
