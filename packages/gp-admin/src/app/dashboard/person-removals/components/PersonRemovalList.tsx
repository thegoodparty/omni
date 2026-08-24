import { Badge, Code, Table, Text } from '@radix-ui/themes'
import type { PersonProfileRemoval } from '@goodparty_org/sdk'
import { formatDate } from '@/lib/utils/date'
import { RestoreProfileButton } from './RestoreProfileButton'

interface PersonRemovalListProps {
  removals: PersonProfileRemoval[]
}

export function PersonRemovalList({ removals }: PersonRemovalListProps) {
  if (removals.length === 0) {
    return (
      <Text color="gray" size="3">
        No profiles are currently removed.
      </Text>
    )
  }

  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell>Person</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Note</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Removed by</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Removed on</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Restored by</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Action</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {removals.map((removal) => (
          <Table.Row key={removal.personId}>
            <Table.Cell>
              {/* The subject usually has no user record to link to, so the
                  civics personId is the only handle there is. */}
              <Code size="1">{removal.personId}</Code>
            </Table.Cell>
            <Table.Cell>
              {removal.clearedAt ? (
                <Badge color="gray">Restored</Badge>
              ) : (
                <Badge color="red">Removed</Badge>
              )}
            </Table.Cell>
            <Table.Cell>{removal.note || '—'}</Table.Cell>
            <Table.Cell>{removal.appliedBy}</Table.Cell>
            <Table.Cell>{formatDate(removal.requestedAt)}</Table.Cell>
            <Table.Cell>
              {removal.clearedAt ? (
                <>
                  <Text as="div" size="2">
                    {removal.clearedBy ?? '—'}
                  </Text>
                  <Text as="div" size="1" color="gray">
                    {formatDate(removal.clearedAt)}
                  </Text>
                </>
              ) : (
                '—'
              )}
            </Table.Cell>
            <Table.Cell>
              {removal.clearedAt ? null : (
                <RestoreProfileButton personId={removal.personId} />
              )}
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  )
}
