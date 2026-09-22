import { Metadata } from 'next'
import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { notFound, redirect } from 'next/navigation'
import {
  Badge,
  Box,
  Callout,
  Card,
  Container,
  DataList,
  Flex,
  Heading,
  Text,
} from '@radix-ui/themes'
import { PERMISSIONS } from '@/lib/permissions'
import { formatDateTime } from '@/lib/utils/date'
import { getResultsTarget } from '../actions'
import { isEndpointsUnavailable } from '../gateway'
import { EndpointsPendingCallout } from '../components/EndpointsPendingCallout'
import { ResultsUploader } from '../components/ResultsUploader'
import { outreachTypeLabel, type OutreachResultsTarget } from '../types'

export const metadata: Metadata = {
  title: 'Upload Outreach Results | GP Admin',
}

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ outreachId: string }>
}

function BackLink() {
  return (
    <Link
      href="/dashboard/outreach-results"
      className="text-[var(--accent-11)] hover:underline"
    >
      ← Outreach results
    </Link>
  )
}

export default async function Page({ params }: PageProps) {
  const { has, orgId } = await auth()
  if (!has?.({ permission: PERMISSIONS.READ_CAMPAIGNS }) || !orgId) {
    redirect('/dashboard/users')
  }
  const canUpload = has({ role: 'org:admin' })

  const { outreachId: idParam } = await params
  const outreachId = Number(idParam)
  if (!Number.isInteger(outreachId) || outreachId < 1) notFound()

  let target: OutreachResultsTarget
  try {
    target = await getResultsTarget(outreachId)
  } catch (err) {
    if (isEndpointsUnavailable(err)) {
      return (
        <Container size="3">
          <BackLink />
          <Heading size="6" mt="3">
            Send {outreachId}
          </Heading>
          <EndpointsPendingCallout />
        </Container>
      )
    }
    notFound()
  }

  const sendLabel = target.name ?? `send ${target.outreachId}`

  return (
    <Container size="3">
      <BackLink />

      <Flex align="center" gap="3" mt="3" mb="1" wrap="wrap">
        <Heading size="6">{target.name ?? `Send ${target.outreachId}`}</Heading>
        <Badge color="gray" size="2">
          {outreachTypeLabel(target.outreachType)}
        </Badge>
        {target.resultsReceivedAt && (
          <Badge color="green" size="2">
            Results already in
          </Badge>
        )}
      </Flex>
      <Text color="gray" size="2">
        {target.organizationSlug} · outreach {target.outreachId}
      </Text>

      {/* What this page is about, before it will take a file. A human who
          followed a Slack link should be able to tell in one glance whether
          this is the send they have results for. */}
      <Card mt="4">
        <Heading size="3" mb="2">
          What this send was
        </Heading>
        <DataList.Root size="2">
          <DataList.Item>
            <DataList.Label>Recipients</DataList.Label>
            <DataList.Value>
              {target.recipientCount.toLocaleString()}
            </DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label>Sent</DataList.Label>
            <DataList.Value>{formatDateTime(target.sentAt)}</DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label>Results expected</DataList.Label>
            <DataList.Value>{formatDateTime(target.expectedBy)}</DataList.Value>
          </DataList.Item>
        </DataList.Root>
        <Box mt="3">
          <Text size="2" weight="medium" as="p" mb="1">
            Message as it went out
          </Text>
          {target.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={target.imageUrl}
              alt="Attachment sent with the message"
              style={{
                maxHeight: 200,
                borderRadius: 8,
                marginBottom: 8,
                maxWidth: '100%',
              }}
            />
          )}
          <Text size="2" color="gray" style={{ whiteSpace: 'pre-wrap' }}>
            {target.message ?? '—'}
          </Text>
        </Box>
      </Card>

      {target.resultsReceivedAt && (
        <Callout.Root color="amber" mt="4">
          <Callout.Text>
            Results were already uploaded for this send on{' '}
            {formatDateTime(target.resultsReceivedAt)}. Uploading again replaces
            what is there rather than adding to it.
          </Callout.Text>
        </Callout.Root>
      )}

      <Box mt="4">
        {canUpload ? (
          <ResultsUploader
            outreachId={target.outreachId}
            sendLabel={sendLabel}
          />
        ) : (
          <Callout.Root color="gray">
            <Callout.Text>
              Uploading results writes to constituent records, so it is
              admin-only. Ask an admin to upload the file for this send.
            </Callout.Text>
          </Callout.Root>
        )}
      </Box>
    </Container>
  )
}
