import Link from 'next/link'
import { Badge, Table, Text } from '@radix-ui/themes'
import { formatDate } from '@/lib/utils/date'
import { ReviewBriefingButton } from './ReviewBriefingButton'
import type { BriefingAdminRow } from '../types'

interface BriefingListProps {
  briefings: BriefingAdminRow[]
}

export function BriefingList({ briefings }: BriefingListProps) {
  if (briefings.length === 0) {
    return (
      <Text color="gray" size="3">
        No briefings found matching your search criteria.
      </Text>
    )
  }

  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell>User name</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Email</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Elected Office</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Meeting date</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Meeting name</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Updated</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Review</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Action</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {briefings.map((briefing) => (
          <Table.Row key={briefing.briefingId}>
            <Table.Cell>
              <Link
                href={`/dashboard/users/${briefing.user.id}`}
                className="text-[var(--accent-11)] hover:underline"
              >
                {briefing.user.firstName} {briefing.user.lastName}
              </Link>
            </Table.Cell>
            <Table.Cell>{briefing.user.email}</Table.Cell>
            <Table.Cell>
              {briefing.electedOffice.organizationSlug}
              {briefing.electedOffice.positionName
                ? ` · ${briefing.electedOffice.positionName}`
                : ''}
            </Table.Cell>
            <Table.Cell>{formatDate(briefing.meetingDate)}</Table.Cell>
            <Table.Cell>{briefing.meetingName ?? '—'}</Table.Cell>
            <Table.Cell>{formatDate(briefing.updatedAt)}</Table.Cell>
            <Table.Cell>
              {briefing.review ? (
                <>
                  <Badge
                    color={
                      briefing.review.verdict === 'passed' ? 'green' : 'red'
                    }
                    title={briefing.review.failReason ?? undefined}
                  >
                    {briefing.review.verdict === 'passed' ? 'Passed' : 'Failed'}
                  </Badge>
                  <Text as="div" size="1" color="gray">
                    {[
                      briefing.review.reviewerEmail,
                      formatDate(briefing.review.reviewedAt),
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  </Text>
                </>
              ) : (
                <Badge color="gray">Pending</Badge>
              )}
            </Table.Cell>
            <Table.Cell>
              <ReviewBriefingButton briefingId={briefing.briefingId} />
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  )
}
