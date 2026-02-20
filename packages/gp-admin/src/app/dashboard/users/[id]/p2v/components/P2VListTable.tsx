import Link from 'next/link'
import { Table, Text, Badge } from '@radix-ui/themes'
import { P2VStatus, type PathToVictory } from '@goodparty_org/sdk'

interface P2VListTableProps {
  pathsToVictory: PathToVictory[]
  basePath: string
}

function statusColor(status: P2VStatus | undefined) {
  switch (status) {
    case P2VStatus.complete:
      return 'green'
    case P2VStatus.waiting:
      return 'orange'
    case P2VStatus.failed:
      return 'red'
    case P2VStatus.districtMatched:
      return 'blue'
    default:
      return 'gray'
  }
}

export function P2VListTable({ pathsToVictory, basePath }: P2VListTableProps) {
  if (pathsToVictory.length === 0) {
    return (
      <Text color="gray" size="3">
        No paths to victory found for this user.
      </Text>
    )
  }

  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell>ID</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Campaign ID</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Election Type</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Election Location</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {pathsToVictory.map((p2v) => (
          <Table.Row key={p2v.id}>
            <Table.Cell>
              <Link
                href={`${basePath}/${p2v.id}`}
                className="text-[var(--accent-11)] hover:underline"
              >
                {p2v.id}
              </Link>
            </Table.Cell>
            <Table.Cell>{p2v.campaignId}</Table.Cell>
            <Table.Cell>
              <Badge color={statusColor(p2v.data?.p2vStatus)} variant="soft">
                {p2v.data?.p2vStatus ?? 'Not set'}
              </Badge>
            </Table.Cell>
            <Table.Cell>{p2v.data?.electionType ?? '—'}</Table.Cell>
            <Table.Cell>{p2v.data?.electionLocation ?? '—'}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  )
}
