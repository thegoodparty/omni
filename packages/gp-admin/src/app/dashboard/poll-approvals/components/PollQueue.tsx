'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Badge, Box, Flex, Table, Tabs, Text } from '@radix-ui/themes'
import type { PollQueueItem } from '@goodparty_org/contracts'
import { formatDateTime } from '@/lib/utils/date'
import {
  STATUS_COLORS,
  STATUS_LABELS,
  TAB_LABELS,
  TAB_STATUSES,
  type QueueTab,
} from '../types'

interface PollQueueProps {
  items: PollQueueItem[]
}

const TABS: QueueTab[] = ['awaiting', 'approved', 'denied']
const EXCERPT_LENGTH = 90

const excerpt = (question: string | null) => {
  if (!question) return '—'
  return question.length > EXCERPT_LENGTH
    ? `${question.slice(0, EXCERPT_LENGTH).trimEnd()}…`
    : question
}

const rowKey = (item: PollQueueItem) =>
  `${item.outreachId}:${item.expansionId ?? 'poll'}`

export function PollQueue({ items }: PollQueueProps) {
  const router = useRouter()
  const [tab, setTab] = useState<QueueTab>('awaiting')

  const byTab = (key: QueueTab) =>
    items.filter((item) => TAB_STATUSES[key].includes(item.approvalStatus))

  const visible = [...byTab(tab)].sort((a, b) => {
    const aTime = a.sendAt ? new Date(a.sendAt).getTime() : Infinity
    const bTime = b.sendAt ? new Date(b.sendAt).getTime() : Infinity
    return aTime - bTime
  })

  return (
    <Box mt="4">
      <Tabs.Root
        value={tab}
        onValueChange={(value) => setTab(value as QueueTab)}
      >
        <Tabs.List>
          {TABS.map((key) => (
            <Tabs.Trigger key={key} value={key}>
              {`${TAB_LABELS[key]} (${byTab(key).length})`}
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
              <Table.ColumnHeaderCell>Organization</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Question</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Texts</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Send date</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {visible.map((item) => (
              <Table.Row
                key={rowKey(item)}
                className="cursor-pointer hover:bg-[var(--gray-a2)]"
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey) return
                  router.push(`/dashboard/poll-approvals/${item.outreachId}`)
                }}
              >
                <Table.Cell>
                  <Flex direction="column">
                    <Link
                      href={`/dashboard/poll-approvals/${item.outreachId}`}
                      className="text-[var(--accent-11)] hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {item.organizationSlug}
                    </Link>
                    <Text size="1" color="gray">
                      {item.name ?? item.topic}
                    </Text>
                  </Flex>
                </Table.Cell>
                <Table.Cell>
                  <Flex align="center" gap="2" wrap="wrap">
                    <Text size="2">{excerpt(item.question)}</Text>
                    {item.kind === 'expansion' && (
                      <Badge color="blue">Expansion</Badge>
                    )}
                  </Flex>
                </Table.Cell>
                <Table.Cell>
                  {item.textCount?.toLocaleString() ?? '—'}
                </Table.Cell>
                <Table.Cell>{formatDateTime(item.sendAt)}</Table.Cell>
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
