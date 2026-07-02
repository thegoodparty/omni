import Link from 'next/link'
import { Table, Text, Badge } from '@radix-ui/themes'
import type {
  AgentRunListItem,
  AgentRunCandidateSummary,
} from '@goodparty_org/sdk'
import {
  STATUS_BADGE_COLORS,
  STATUS_BADGE_LABELS,
  formatCost,
  formatDuration,
  formatTimestamp,
} from '../types'

interface AgentRunListProps {
  runs: AgentRunListItem[]
}

function formatCandidate(candidate: AgentRunCandidateSummary | null): string {
  if (!candidate) return '—'
  return `${candidate.firstName} ${candidate.lastName}`.trim() || '—'
}

export function AgentRunList({ runs }: AgentRunListProps) {
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
          <Table.ColumnHeaderCell>Experiment</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Candidate</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Duration</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Cost</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Created</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {runs.map((run) => (
          <Table.Row key={run.runId}>
            <Table.Cell>
              <Link
                href={`/dashboard/agent-runs/${run.runId}`}
                className="text-[var(--accent-11)] hover:underline"
              >
                {run.experimentType}
              </Link>
            </Table.Cell>
            <Table.Cell>{formatCandidate(run.candidate)}</Table.Cell>
            <Table.Cell>
              <Badge color={STATUS_BADGE_COLORS[run.status]}>
                {STATUS_BADGE_LABELS[run.status] ?? run.status}
              </Badge>
            </Table.Cell>
            <Table.Cell>{formatDuration(run.durationSeconds)}</Table.Cell>
            <Table.Cell>{formatCost(run.costUsd)}</Table.Cell>
            <Table.Cell>{formatTimestamp(run.createdAt)}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  )
}
