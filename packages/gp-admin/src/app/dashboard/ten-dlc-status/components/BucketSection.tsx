'use client'

import Link from 'next/link'
import {
  Badge,
  Button,
  Card,
  Flex,
  Heading,
  Table,
  Text,
} from '@radix-ui/themes'
import { HiOutlineExternalLink } from 'react-icons/hi'
import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import type { TenDlcStatusBucket, TenDlcStatusEntry } from '@goodparty_org/sdk'
import { ProtectedContent } from '@/components/ProtectedContent'
import { PERMISSIONS } from '@/lib/permissions'
import { ResendCvPinButton } from '@/app/dashboard/campaigns/components/ResendCvPinButton'
import { useCvHoldOverride } from '@/app/dashboard/campaigns/components/useCvHoldOverride'
import { BUCKET_META, RADIX_UNSUSPENSION_URL, TONE_FILL } from '../bucketMeta'

const linkClass = 'text-[var(--accent-11)] hover:underline'

const daysSince = (iso: string | null): string =>
  iso === null ? '—' : `${differenceInCalendarDays(new Date(), parseISO(iso))}d`

const shortDate = (iso: string): string => format(parseISO(iso), 'MMM d, yyyy')

function OverrideHoldButton({ campaignId }: { campaignId: number }) {
  const { override, overriding, overridden } = useCvHoldOverride(campaignId)

  return (
    <Button
      size="1"
      variant="outline"
      color="red"
      onClick={override}
      disabled={overriding || overridden}
    >
      {overridden
        ? 'Hold cleared'
        : overriding
          ? 'Overriding...'
          : 'Override hold & resubmit'}
    </Button>
  )
}

function EntryContext({
  bucketKey,
  entry,
}: {
  bucketKey: TenDlcStatusBucket['key']
  entry: TenDlcStatusEntry
}) {
  switch (bucketKey) {
    case 'stuckSubmission':
      return (
        <Flex gap="2" align="center" wrap="wrap">
          <Text size="1" color="gray">
            {entry.agenticRunId
              ? `run ${entry.agenticRunId} (${entry.runStatus ?? 'unknown'})`
              : 'no run'}
          </Text>
          {entry.cvValidationFailedAt && (
            <Badge color="red" size="1">
              CV validation hold
            </Badge>
          )}
        </Flex>
      )
    case 'rejected':
      return (
        <Badge color={entry.peerlyIdentityId ? 'red' : 'amber'} size="1">
          {entry.peerlyIdentityId
            ? 'identity minted — escalate to Peerly'
            : 'no identity — repair data, then reset status'}
        </Badge>
      )
    case 'domainPurchaseIncomplete':
    case 'domainNotResolving':
      return (
        <Text size="1" color="gray">
          {entry.domainName} ({entry.domainStatus})
        </Text>
      )
    case 'cvInReviewStalled':
    case 'finalizeStalled':
      return (
        <Text size="1" color="gray">
          {entry.peerlyIdentityId} ·{' '}
          {entry.escalatedAt
            ? `escalated ${shortDate(entry.escalatedAt)}`
            : 'escalation pending'}
        </Text>
      )
    case 'dispatchDeferred':
      return entry.missingUser ? (
        <Badge color="red" size="1">
          missing user association (data repair)
        </Badge>
      ) : (
        <Text size="1" color="gray">
          waiting on a genuine bio/policy issue
        </Text>
      )
    case 'cvUnissued':
      return (
        <Text size="1" color="gray">
          {entry.peerlyIdentityId} · CV {entry.peerlyCvStatus}
        </Text>
      )
    default:
      return entry.peerlyIdentityId ? (
        <Text size="1" color="gray">
          {entry.peerlyIdentityId}
        </Text>
      ) : null
  }
}

function EntryActions({
  bucketKey,
  entry,
}: {
  bucketKey: TenDlcStatusBucket['key']
  entry: TenDlcStatusEntry
}) {
  return (
    <Flex gap="2" align="center" wrap="wrap">
      {bucketKey === 'awaitingPin' && (
        <ProtectedContent
          requiredPermission={PERMISSIONS.WRITE_CAMPAIGNS}
          hideWhenUnauthorized
        >
          <ResendCvPinButton campaignId={entry.campaignId} size="1" />
        </ProtectedContent>
      )}
      {bucketKey === 'stuckSubmission' && entry.cvValidationFailedAt && (
        <ProtectedContent
          requiredPermission={PERMISSIONS.WRITE_CAMPAIGNS}
          hideWhenUnauthorized
        >
          <OverrideHoldButton campaignId={entry.campaignId} />
        </ProtectedContent>
      )}
      {bucketKey === 'domainNotResolving' && (
        <Button asChild size="1" variant="soft" color="gray">
          <a href={RADIX_UNSUSPENSION_URL} target="_blank" rel="noreferrer">
            Radix unsuspension
            <HiOutlineExternalLink />
          </a>
        </Button>
      )}
      {entry.filingUrl && (
        <Button asChild size="1" variant="soft" color="gray">
          <a href={entry.filingUrl} target="_blank" rel="noreferrer">
            Filing
            <HiOutlineExternalLink />
          </a>
        </Button>
      )}
      <Button asChild size="1" variant="soft">
        <Link href={`/dashboard/users/${entry.userId}`}>View user</Link>
      </Button>
    </Flex>
  )
}

export function BucketSection({ bucket }: { bucket: TenDlcStatusBucket }) {
  const meta = BUCKET_META[bucket.key]
  return (
    <Card
      mb="4"
      style={{ boxShadow: `inset 0 3px 0 0 ${TONE_FILL[meta.tone]}` }}
    >
      <Flex direction="column" gap="2" pt="1">
        <Flex
          gap="2"
          align="center"
          pb="2"
          style={{ borderBottom: '1px solid var(--gray-5)' }}
        >
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              backgroundColor: TONE_FILL[meta.tone],
            }}
          />
          <Heading size="3">{meta.label}</Heading>
          <Badge color={meta.tone}>{bucket.entries.length}</Badge>
        </Flex>
        <Text size="1" color="gray">
          {meta.hint}
        </Text>
        <Table.Root size="1">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Campaign</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Committee</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Waiting</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Context</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Actions</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {bucket.entries.map((entry) => (
              <Table.Row key={`${bucket.key}-${entry.campaignId}`}>
                <Table.Cell>
                  <Link
                    href={`/dashboard/users/${entry.userId}`}
                    className={linkClass}
                  >
                    {entry.campaignSlug}
                  </Link>{' '}
                  <Text size="1" color="gray">
                    #{entry.campaignId}
                  </Text>
                </Table.Cell>
                <Table.Cell>{entry.committeeName ?? '—'}</Table.Cell>
                <Table.Cell>{daysSince(entry.since)}</Table.Cell>
                <Table.Cell>
                  <EntryContext bucketKey={bucket.key} entry={entry} />
                </Table.Cell>
                <Table.Cell>
                  <EntryActions bucketKey={bucket.key} entry={entry} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Flex>
    </Card>
  )
}
