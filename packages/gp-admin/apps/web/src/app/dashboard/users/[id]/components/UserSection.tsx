'use client'

import { Grid, Badge, Flex } from '@radix-ui/themes'
import { formatPhone } from '@/lib/utils/phone'
import { InfoCard } from './InfoCard'
import { DataRow } from './DataRow'
import { useUser } from '../context/UserContext'

export function UserSection() {
  const user = useUser()

  return (
    <Grid columns={{ initial: '1', md: '2' }} gap="4">
      <InfoCard title="Personal Information">
        <DataRow label="User ID">{user.id}</DataRow>
        <DataRow label="First Name">{user.firstName}</DataRow>
        <DataRow label="Last Name">{user.lastName}</DataRow>
        <DataRow label="Email">{user.email}</DataRow>
        <DataRow label="Phone">{formatPhone(user.phone)}</DataRow>
        <DataRow label="ZIP">{user.zip}</DataRow>
      </InfoCard>

      <InfoCard title="Metadata">
        <DataRow label="HubSpot ID">{user.metaData?.hubspotId}</DataRow>
        <DataRow label="Text Notifications">
          <Badge
            color={user.metaData?.textNotifications ? 'green' : 'gray'}
            variant="soft"
          >
            {user.metaData?.textNotifications ? 'Enabled' : 'Disabled'}
          </Badge>
        </DataRow>
      </InfoCard>

      <InfoCard title="Roles">
        <Flex gap="2" wrap="wrap">
          {user.roles && user.roles.length > 0 ? (
            user.roles.map((role) => (
              <Badge key={role} color="blue" variant="soft">
                {role}
              </Badge>
            ))
          ) : (
            <Badge color="gray" variant="soft">
              No roles assigned
            </Badge>
          )}
        </Flex>
      </InfoCard>
    </Grid>
  )
}
