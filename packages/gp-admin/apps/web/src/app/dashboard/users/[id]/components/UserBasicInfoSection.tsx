import { Grid, Text, Badge, Flex, Link } from '@radix-ui/themes'
import { formatDate } from '@/lib/utils/date'
import { InfoCard } from './InfoCard'
import { DataRow } from './DataRow'
import type { DetailedUser } from '../types'

interface UserBasicInfoSectionProps {
  user: DetailedUser
}

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

export function UserBasicInfoSection({ user }: UserBasicInfoSectionProps) {
  const { details, data } = user

  return (
    <Grid columns={{ initial: '1', md: '2' }} gap="4">
      <InfoCard title="Personal Information">
        <DataRow label="User ID" value={user.userId} />
        <DataRow label="Campaign ID" value={user.id} />
        <DataRow label="Slug" value={user.slug} />
        <DataRow
          label="Name"
          value={`${details.firstName} ${details.lastName}`}
        />
        <DataRow label="Date of Birth" value={formatDate(details.dob)} />
        <DataRow label="Phone" value={formatPhone(details.phone)} />
        <DataRow
          label="Campaign Phone"
          value={formatPhone(details.campaignPhone)}
        />
        <DataRow
          label="Website"
          value={
            details.website ? (
              <Link href={details.website} target="_blank">
                {details.website}
              </Link>
            ) : (
              '—'
            )
          }
        />
        <DataRow label="HubSpot ID" value={data.hubspotId} />
      </InfoCard>

      <InfoCard title="Location">
        <DataRow label="City" value={details.city} />
        <DataRow label="County" value={details.county} />
        <DataRow label="State" value={details.state} />
        <DataRow label="ZIP" value={details.zip} />
        <DataRow
          label="Geo Location"
          value={
            details.geoLocation?.lat !== undefined &&
            details.geoLocation?.lng !== undefined
              ? `${details.geoLocation.lat.toFixed(4)}, ${details.geoLocation.lng.toFixed(4)}`
              : '—'
          }
        />
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
        <DataRow label="Created" value={formatDate(user.createdAt)} />
        <DataRow label="Updated" value={formatDate(user.updatedAt)} />
        <DataRow
          label="Date Verified"
          value={
            user.dateVerified ? formatDate(user.dateVerified) : 'Not verified'
          }
        />
        <DataRow label="Last Visited" value={formatDate(data.lastVisited)} />
        <DataRow label="Last Step Date" value={data.lastStepDate} />
        <DataRow label="Current Step" value={data.currentStep} />
      </InfoCard>
    </Grid>
  )
}
