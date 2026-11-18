import Link from 'next/link'
import { Badge, Table, Text } from '@radix-ui/themes'
import type { BackgroundAgentRunListItem } from '@/shared/gpApi'
import { STATUS_BADGE_COLORS, formatDuration, formatTimestamp } from '../types'

interface BackgroundAgentRunListProps {
  runs: BackgroundAgentRunListItem[]
}

export const BackgroundAgentRunList = ({
  runs,
}: BackgroundAgentRunListProps) => {
  if (runs.length === 0) {
    return (
      <Text color="gray" size="3">
        No agent runs found matching your filters.
      </Text>
    )
  }

  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell>Agent</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Organization</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Duration</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Created</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {runs.map((run) => (
          <Table.Row key={run.runId}>
            <Table.Cell>
              <Link
                href={`/dashboard/background-agent-runs/${run.runId}`}
                className="text-[var(--accent-11)] hover:underline"
              >
                {run.agentName}
              </Link>
            </Table.Cell>
            <Table.Cell>{run.organizationSlug}</Table.Cell>
            <Table.Cell>
              <Badge color={STATUS_BADGE_COLORS[run.status]}>
                {run.status}
              </Badge>
            </Table.Cell>
            <Table.Cell>{formatDuration(run.durationSeconds)}</Table.Cell>
            <Table.Cell>{formatTimestamp(run.createdAt)}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  )
}
