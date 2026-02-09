'use client'

import { Grid, Badge, Flex } from '@radix-ui/themes'
import { formatPhone } from '@/lib/utils/phone'
import { InfoCard } from './InfoCard'
import { DataRow } from './DataRow'
import { useUser } from '../context/UserContext'
import { UserRole } from '@goodparty_org/sdk'

export function UserSection() {
  const {
    id,
    firstName,
    lastName,
    email,
    phone,
    zip,
    metaData,
    roles = [] as UserRole[],
  } = useUser()
  const { hubspotId, textNotifications } = metaData ?? {}

  return (
    <Grid columns={{ initial: '1', md: '2' }} gap="4">
      <InfoCard title="Personal Information">
        <DataRow label="User ID">{id}</DataRow>
        <DataRow label="First Name">{firstName}</DataRow>
        <DataRow label="Last Name">{lastName}</DataRow>
        <DataRow label="Email">{email}</DataRow>
        <DataRow label="Phone">{formatPhone(phone)}</DataRow>
        <DataRow label="ZIP">{zip}</DataRow>
      </InfoCard>

      <InfoCard title="Metadata">
        <DataRow label="HubSpot ID">{hubspotId}</DataRow>
        <DataRow label="Text Notifications">
          <Badge color={textNotifications ? 'green' : 'gray'} variant="soft">
            {textNotifications ? 'Enabled' : 'Disabled'}
          </Badge>
        </DataRow>
      </InfoCard>

      <InfoCard title="Roles">
        <Flex gap="2" wrap="wrap">
          {roles && roles.length > 0 ? (
            roles.map((role) => (
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
