'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Badge, Box, Flex, Table, Tabs, Text } from '@radix-ui/themes'
import type { SmsApprovalQueueItem } from '@goodparty_org/contracts'
import { formatDate } from '@/lib/utils/date'
import {
  STATUS_COLORS,
  STATUS_LABELS,
  TAB_STATUSES,
  type QueueTab,
} from '../types'

interface SmsQueueProps {
  items: SmsApprovalQueueItem[]
}

const tabLabel = (tab: QueueTab, count: number) =>
  `${
    tab === 'awaiting'
      ? 'Awaiting review'
      : tab === 'booked'
        ? 'Booked'
        : 'Denied'
  } (${count})`

export function SmsQueue({ items }: SmsQueueProps) {
  const [tab, setTab] = useState<QueueTab>('awaiting')

  const byTab = (key: QueueTab) =>
    items.filter((item) => TAB_STATUSES[key].includes(item.approvalStatus))
  const visible = byTab(tab)

  return (
    <Box mt="4">
      <Tabs.Root
        value={tab}
        onValueChange={(value) => setTab(value as QueueTab)}
      >
        <Tabs.List>
          {(['awaiting', 'booked', 'denied'] as const).map((key) => (
            <Tabs.Trigger key={key} value={key}>
              {tabLabel(key, byTab(key).length)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>

      {visible.length === 0 ? (
        <Text color="gray" size="3" mt="4" as="p">
          Nothing here right now.
        </Text>
      ) : (
        <Table.Root mt="4">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Campaign</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Candidate</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Send date</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Audience</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Standards</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Readiness</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {visible.map((item) => (
              <Table.Row key={item.id}>
                <Table.Cell>
                  <Link
                    href={`/dashboard/sms-outreach/${item.id}`}
                    className="text-[var(--accent-11)] hover:underline"
                  >
                    {item.name ?? `Campaign ${item.id}`}
                  </Link>
                </Table.Cell>
                <Table.Cell>
                  <Flex direction="column">
                    <Text size="2">{item.candidateName ?? '—'}</Text>
                    <Text size="1" color="gray">
                      {item.campaignSlug}
                    </Text>
                  </Flex>
                </Table.Cell>
                <Table.Cell>
                  {item.sendAt ? formatDate(item.sendAt) : '—'}
                </Table.Cell>
                <Table.Cell>
                  {(
                    item.billableTextCount ?? item.textCount
                  )?.toLocaleString() ?? '—'}
                  {item.paid ? '' : ' (free)'}
                </Table.Cell>
                <Table.Cell>
                  {item.standards === null ? (
                    <Badge color="gray">No message</Badge>
                  ) : item.standards.passed ? (
                    <Badge color="green">Pass</Badge>
                  ) : (
                    <Badge color="red">
                      {item.standards.failures.length} issue
                      {item.standards.failures.length === 1 ? '' : 's'}
                    </Badge>
                  )}
                </Table.Cell>
                <Table.Cell>
                  {item.job === null ? (
                    <Badge color="gray">Vendor read failed</Badge>
                  ) : item.job.deliverabilityCheckError ? (
                    <Badge color="red">Deliverability error</Badge>
                  ) : (
                    <Badge color="green">Ready</Badge>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <Badge color={STATUS_COLORS[item.approvalStatus]}>
                    {STATUS_LABELS[item.approvalStatus]}
                  </Badge>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </Box>
  )
}
