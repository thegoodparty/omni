import Link from 'next/link'
import { Table, Text, Badge } from '@radix-ui/themes'
import type { ElectedOffice } from '@goodparty_org/sdk'
import { formatDate } from '@/lib/utils/date'

interface ElectedOfficeListTableProps {
  electedOffices: ElectedOffice[]
  basePath: string
}

export function ElectedOfficeListTable({
  electedOffices,
  basePath,
}: ElectedOfficeListTableProps) {
  if (electedOffices.length === 0) {
    return (
      <Text color="gray" size="3">
        No elected offices found for this user.
      </Text>
    )
  }

  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell>ID</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Campaign ID</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Elected Date</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Term End Date</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {electedOffices.map((office) => (
          <Table.Row key={office.id}>
            <Table.Cell>
              <Link
                href={`${basePath}/${office.id}`}
                className="text-[var(--accent-11)] hover:underline"
              >
                {office.id}
              </Link>
            </Table.Cell>
            <Table.Cell>{office.campaignId}</Table.Cell>
            <Table.Cell>{formatDate(office.electedDate)}</Table.Cell>
            <Table.Cell>{formatDate(office.termEndDate)}</Table.Cell>
            <Table.Cell>
              <Badge color={office.isActive ? 'green' : 'gray'} variant="soft">
                {office.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  )
}
