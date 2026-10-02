'use client'

import { Fragment } from 'react'
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
import { EditFilingUrlAction } from '@/app/dashboard/campaigns/components/EditFilingUrlAction'
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

// The what's-wrong / what-to-do line rendered in a full-width row under the
// entry. Returns null when the bucket's card hint already says everything and
// the row carries no entry-specific detail — no empty gray stripes.
function entryExplanation(
  bucketKey: TenDlcStatusBucket['key'],
  entry: TenDlcStatusEntry
) {
  switch (bucketKey) {
    case 'stuckSubmission':
      return entry.cvValidationFailedAt ? (
        <Flex gap="2" align="center" wrap="wrap">
          <Badge color="red" size="1">
            CV validation hold
          </Badge>
          <Text size="1" color="gray">
            The validator could not confirm this filing page. Open Filing: wrong
            link → Edit (revalidates fresh); correct link the validator
            can&apos;t read → verify it yourself, then Override hold &amp;
            resubmit.
          </Text>
        </Flex>
      ) : (
        <Text size="1" color="gray">
          No CV hold — it stopped inside the agent run.{' '}
          {entry.agenticRunId ? (
            <>
              Open{' '}
              <Link
                href={`/dashboard/agent-runs/${entry.agenticRunId}`}
                className={linkClass}
              >
                run {entry.agenticRunId}
              </Link>{' '}
              ({entry.runStatus ?? 'unknown'}) to read the blocker
              {entry.runStatus === 'SUPERSEDED'
                ? ' — a resume run superseded this one; follow it to the latest attempt.'
                : '.'}
            </>
          ) : (
            'No run was ever recorded for the kickoff — check the queue consumer logs.'
          )}
        </Text>
      )
    case 'rejected':
      return (
        <Text size="1" color="gray">
          {entry.peerlyIdentityId
            ? `${entry.peerlyIdentityId} — CampaignVerify rejected after ` +
              'submission and the identity exists at Peerly, so a local ' +
              'data fix can never reach them. Escalate in the shared ' +
              'Peerly channel to withdraw/recreate the CV request.'
            : 'Rejected before any Peerly identity existed. Fix the filing ' +
              'link (Edit), then reset the record status so the next run ' +
              'resubmits — see the recover-rejected runbook.'}
        </Text>
      )
    case 'domainPurchaseIncomplete':
      return (
        <Text size="1" color="gray">
          {entry.domainName} ({entry.domainStatus}) — the registrar purchase
          never completed, so the site can&apos;t go live. Check the Vercel buy
          order for this domain.
        </Text>
      )
    case 'domainNotResolving':
      return (
        <Text size="1" color="gray">
          {entry.domainName} ({entry.domainStatus}) — no DNS delegation. Run
          whois first: serverHold → file the Radix unsuspension; clientHold →
          the registration lapsed, renew via the Vercel registrar API.
        </Text>
      )
    case 'cvInReviewStalled':
    case 'finalizeStalled':
      return (
        <Text size="1" color="gray">
          {entry.peerlyIdentityId} —{' '}
          {bucketKey === 'cvInReviewStalled'
            ? 'CampaignVerify has been reviewing past 3 business days.'
            : "the brand is waiting on Peerly's finalize confirmation."}{' '}
          {entry.escalatedAt
            ? `Escalated to Peerly ${shortDate(entry.escalatedAt)} — waiting on the vendor.`
            : 'Escalation posts to the shared Peerly channel next weekday 11am ET.'}
        </Text>
      )
    case 'dispatchDeferred':
      return entry.missingUser ? (
        <Flex gap="2" align="center" wrap="wrap">
          <Badge color="red" size="1">
            missing user association (data repair)
          </Badge>
          <Text size="1" color="gray">
            No user is linked to this campaign, so nothing can dispatch until
            the association is repaired.
          </Text>
        </Flex>
      ) : (
        <Text size="1" color="gray">
          Waiting on the candidate to author a genuine bio and policy issue —
          the sweep dispatches automatically once they do.
        </Text>
      )
    case 'cvUnissued':
      return (
        <Text size="1" color="gray">
          {entry.peerlyIdentityId} — CV {entry.peerlyCvStatus}: CampaignVerify
          hasn&apos;t issued a PIN yet, so don&apos;t nudge the candidate. Past
          3 business days it escalates to Peerly automatically.
        </Text>
      )
    default:
      return null
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
      {/* Edit only before a Peerly identity exists — once CampaignVerify has
          consumed the URL the endpoint 409s and the fix is a Peerly
          escalation, not a local swap. */}
      {entry.filingUrl && !entry.peerlyIdentityId && (
        <ProtectedContent
          requiredPermission={PERMISSIONS.WRITE_CAMPAIGNS}
          hideWhenUnauthorized
        >
          <EditFilingUrlAction
            campaignId={entry.campaignId}
            filingUrl={entry.filingUrl}
          />
        </ProtectedContent>
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
              <Table.ColumnHeaderCell>Assigned to</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Waiting</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Actions</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {bucket.entries.map((entry) => {
              const explanation = entryExplanation(bucket.key, entry)
              return (
                <Fragment key={`${bucket.key}-${entry.campaignId}`}>
                  <Table.Row>
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
                    <Table.Cell>
                      {entry.assignedPa ?? (
                        <Text size="1" color="gray">
                          Unassigned
                        </Text>
                      )}
                    </Table.Cell>
                    <Table.Cell>{daysSince(entry.since)}</Table.Cell>
                    <Table.Cell>
                      <EntryActions bucketKey={bucket.key} entry={entry} />
                    </Table.Cell>
                  </Table.Row>
                  {explanation && (
                    <Table.Row>
                      <Table.Cell
                        colSpan={5}
                        style={{ backgroundColor: 'var(--gray-2)' }}
                      >
                        {explanation}
                      </Table.Cell>
                    </Table.Row>
                  )}
                </Fragment>
              )
            })}
          </Table.Body>
        </Table.Root>
      </Flex>
    </Card>
  )
}
