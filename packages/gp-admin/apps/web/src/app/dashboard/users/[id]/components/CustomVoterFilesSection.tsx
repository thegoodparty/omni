import { Text, Badge, Flex, Table } from '@radix-ui/themes'
import { InfoCard } from './InfoCard'
import type { DetailedUser } from '../types'

interface CustomVoterFilesSectionProps {
  user: DetailedUser
}

export function CustomVoterFilesSection({
  user,
}: CustomVoterFilesSectionProps) {
  const files = user.data.customVoterFiles
  if (!files || files.length === 0) return null

  return (
    <InfoCard title={`Custom Voter Files (${files.length})`}>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Channel</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Purpose</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Created</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Filters</Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {files.map((file, index) => (
            <Table.Row key={index}>
              <Table.Cell>
                <Text size="2" weight="medium">
                  {file.name}
                </Text>
              </Table.Cell>
              <Table.Cell>
                <Badge color="blue" variant="soft">
                  {file.channel}
                </Badge>
              </Table.Cell>
              <Table.Cell>
                <Badge color="green" variant="soft">
                  {file.purpose}
                </Badge>
              </Table.Cell>
              <Table.Cell>
                <Text size="2" color="gray">
                  {file.createdAt}
                </Text>
              </Table.Cell>
              <Table.Cell>
                <Flex gap="1" wrap="wrap" style={{ maxWidth: '200px' }}>
                  {file.filters.slice(0, 3).map((filter, i) => (
                    <Badge key={i} color="gray" variant="soft" size="1">
                      {filter
                        .replace('audience_', '')
                        .replace('party_', '')
                        .replace('age_', '')}
                    </Badge>
                  ))}
                  {file.filters.length > 3 && (
                    <Badge color="gray" variant="soft" size="1">
                      +{file.filters.length - 3}
                    </Badge>
                  )}
                </Flex>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </InfoCard>
  )
}
