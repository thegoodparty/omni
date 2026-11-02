import { Badge, Table, Text } from '@radix-ui/themes'
import type { EmailPausedSend } from '@goodparty_org/contracts'
import { formatRate, PAUSE_REASON_LABELS } from '../types'
import { SendActions } from './SendActions'

interface PausedSendsTableProps {
  items: EmailPausedSend[]
  canDecide: boolean
}

export function PausedSendsTable({ items, canDecide }: PausedSendsTableProps) {
  if (items.length === 0) {
    return <Text color="gray">No paused sends.</Text>
  }
  return (
    <Table.Root variant="surface">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell>Send</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Reason</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Paused</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Sent</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Bounce</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Complaint</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {items.map((item) => (
          <Table.Row key={item.outreachId}>
            <Table.Cell>
              <Text weight="medium" as="div">
                {item.subject}
              </Text>
              <Text color="gray" size="1">
                {item.organizationSlug} · {item.senderName}
              </Text>
            </Table.Cell>
            <Table.Cell>
              <Badge color="amber">
                {PAUSE_REASON_LABELS[item.pauseReason]}
              </Badge>
            </Table.Cell>
            <Table.Cell>{new Date(item.pausedAt).toLocaleString()}</Table.Cell>
            <Table.Cell>
              {item.sentCount}
              {item.recipientCap !== null && ` of ${item.recipientCap}`}
            </Table.Cell>
            <Table.Cell>
              {item.metrics
                ? `${formatRate(item.metrics.bounceRate)} (${item.metrics.bounce})`
                : 'Unavailable'}
            </Table.Cell>
            <Table.Cell>
              {item.metrics
                ? `${formatRate(item.metrics.complaintRate)} (${item.metrics.complaint})`
                : 'Unavailable'}
            </Table.Cell>
            <Table.Cell>
              {canDecide && (
                <SendActions
                  outreachId={item.outreachId}
                  canResume={item.pauseReason !== 'ses_tenant'}
                />
              )}
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  )
}
