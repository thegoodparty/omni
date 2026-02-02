'use client'

import { Grid, Text, Badge, Flex, Box, Heading, Link } from '@radix-ui/themes'
import { formatDate } from '@/lib/utils/date'
import { useUser } from '../UserProvider'
import { InfoCard } from './InfoCard'
import { DataRow } from './DataRow'

export function CampaignDetailsDisplaySection() {
  const user = useUser()
  const { details } = user

  return (
    <Grid columns={{ initial: '1', md: '2' }} gap="4">
      <InfoCard title="Location">
        <DataRow label="State">{details.state}</DataRow>
        <DataRow label="City">{details.city}</DataRow>
        <DataRow label="County">{details.county}</DataRow>
        <DataRow label="ZIP">{details.zip}</DataRow>
        <DataRow label="Geo Location">
          {details.geoLocation?.lat != null && details.geoLocation?.lng != null
            ? `${details.geoLocation.lat.toFixed(4)}, ${details.geoLocation.lng.toFixed(4)}`
            : '—'}
        </DataRow>
      </InfoCard>

      <InfoCard title="Office">
        <DataRow label="Office">{details.office}</DataRow>
        <DataRow label="Other Office">{details.otherOffice}</DataRow>
        <DataRow label="Ballot Level">
          <Badge color="blue" variant="soft">
            {details.ballotLevel || 'Not set'}
          </Badge>
        </DataRow>
        <DataRow label="Election Level">
          <Badge color="violet" variant="soft">
            {details.level || 'Not set'}
          </Badge>
        </DataRow>
        <DataRow label="Term Length">{details.officeTermLength}</DataRow>
      </InfoCard>

      <InfoCard title="Election">
        <DataRow label="Election Date">
          {formatDate(details.electionDate)}
        </DataRow>
        <DataRow label="Partisan Type">{details.partisanType}</DataRow>
        <DataRow label="Has Primary">
          <Badge color={details.hasPrimary ? 'blue' : 'gray'}>
            {details.hasPrimary ? 'Yes' : 'No'}
          </Badge>
        </DataRow>
      </InfoCard>

      <InfoCard title="Filing Period">
        <DataRow label="Filing Start">
          {formatDate(details.filingPeriodsStart)}
        </DataRow>
        <DataRow label="Filing End">
          {formatDate(details.filingPeriodsEnd)}
        </DataRow>
      </InfoCard>

      <InfoCard title="Party">
        <DataRow label="Party">
          <Badge color="blue" variant="soft">
            {details.party || 'Not set'}
          </Badge>
        </DataRow>
        <DataRow label="Other Party">{details.otherParty}</DataRow>
      </InfoCard>

      <InfoCard title="Background">
        <DataRow label="Occupation">{details.occupation}</DataRow>
        <DataRow label="Website">
          {details.website ? (
            <Link href={details.website} target="_blank">
              {details.website}
            </Link>
          ) : (
            '—'
          )}
        </DataRow>
        <DataRow label="Pledged">
          <Badge color={details.pledged ? 'green' : 'gray'}>
            {details.pledged ? 'Yes' : 'No'}
          </Badge>
        </DataRow>
      </InfoCard>

      {details.funFact && (
        <InfoCard title="Fun Fact">
          <Text as="p" size="2" style={{ lineHeight: 1.6 }}>
            {details.funFact}
          </Text>
        </InfoCard>
      )}

      {details.pastExperience && (
        <InfoCard title="Past Experience">
          <Text as="p" size="2" style={{ lineHeight: 1.6 }}>
            {typeof details.pastExperience === 'string'
              ? details.pastExperience
              : '—'}
          </Text>
        </InfoCard>
      )}

      {details.runningAgainst && details.runningAgainst.length > 0 && (
        <InfoCard title="Opponents">
          <Flex direction="column" gap="3">
            {details.runningAgainst.map((opponent, index) => (
              <Box key={index} p="3" className="bg-[var(--gray-2)] rounded-md">
                <Heading size="2" mb="1">
                  {opponent.name}
                </Heading>
                <Badge color="red" variant="soft" mb="2">
                  {opponent.party}
                </Badge>
                <Text as="p" size="2" color="gray">
                  {opponent.description}
                </Text>
              </Box>
            ))}
          </Flex>
        </InfoCard>
      )}
    </Grid>
  )
}
