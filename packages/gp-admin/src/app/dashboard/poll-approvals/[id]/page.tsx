import { Metadata } from 'next'
import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { notFound, redirect } from 'next/navigation'
import {
  Badge,
  Box,
  Card,
  Container,
  DataList,
  Flex,
  Heading,
  Text,
} from '@radix-ui/themes'
import { PERMISSIONS } from '@/lib/permissions'
import { formatDate, formatDateTime } from '@/lib/utils/date'
import { getPollDetail } from '../actions'
import { STATUS_COLORS, STATUS_LABELS } from '../types'
import { ApproveDenyActions } from '../components/ApproveDenyActions'
import { EditQuestionAction } from '../components/EditQuestionAction'

export const metadata: Metadata = {
  title: 'Poll review | GP Admin',
}

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

const AUDIENCE_LABELS = { sample: 'Sample', list: 'Uploaded list' } as const

export default async function Page({ params }: PageProps) {
  const { has, orgId } = await auth()
  if (!has?.({ permission: PERMISSIONS.READ_CAMPAIGNS }) || !orgId) {
    redirect('/dashboard/users')
  }
  const canDecide = has({ role: 'org:admin' })

  const { id: idParam } = await params
  const id = Number(idParam)
  if (!Number.isInteger(id) || id < 1) notFound()

  let detail
  try {
    detail = await getPollDetail(id)
  } catch {
    notFound()
  }
  const { item, message, imageUrl, audienceKind, biasOverridden, expansions } =
    detail
  const awaiting = item.approvalStatus === 'awaiting_review'

  return (
    <Container size="3">
      <Link
        href="/dashboard/poll-approvals"
        className="text-[var(--accent-11)] hover:underline"
      >
        ← Poll approvals
      </Link>

      <Flex align="center" gap="3" mt="3" mb="1" wrap="wrap">
        <Heading size="6">{item.name ?? `Poll ${item.outreachId}`}</Heading>
        <Badge color={STATUS_COLORS[item.approvalStatus]} size="2">
          {STATUS_LABELS[item.approvalStatus]}
        </Badge>
        {biasOverridden && (
          <Badge color="orange" size="2">
            Bias override
          </Badge>
        )}
      </Flex>
      <Text color="gray" size="2">
        {item.organizationSlug}
      </Text>

      <Flex gap="4" mt="4" direction={{ initial: 'column', md: 'row' }}>
        <Box flexGrow="1" style={{ minWidth: 0 }}>
          <Card>
            <Heading size="3" mb="2">
              {item.approvalStatus === 'sent'
                ? 'Message as it sent'
                : 'Message as it will send'}
            </Heading>
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt="Poll attachment"
                style={{
                  maxHeight: 240,
                  borderRadius: 8,
                  marginBottom: 12,
                  maxWidth: '100%',
                }}
              />
            )}
            <Text size="2" style={{ whiteSpace: 'pre-wrap' }}>
              {message ?? '—'}
            </Text>
            {canDecide && awaiting && item.question && (
              <Box mt="3">
                <EditQuestionAction
                  id={item.outreachId}
                  question={item.question}
                />
              </Box>
            )}
          </Card>

          {expansions.length > 0 && (
            <Card mt="4">
              <Heading size="3" mb="2">
                Expansions
              </Heading>
              <Flex direction="column" gap="3">
                {expansions.map((expansion) => (
                  <Flex
                    key={expansion.expansionId}
                    justify="between"
                    align="center"
                    gap="3"
                    wrap="wrap"
                  >
                    <Flex direction="column">
                      <Text size="2">
                        {expansion.textCount?.toLocaleString() ?? '—'} texts
                      </Text>
                      <Text size="1" color="gray">
                        Send {formatDateTime(expansion.sendAt)}
                      </Text>
                    </Flex>
                    <Flex align="center" gap="3">
                      <Badge color={STATUS_COLORS[expansion.approvalStatus]}>
                        {STATUS_LABELS[expansion.approvalStatus]}
                      </Badge>
                      {canDecide &&
                        expansion.approvalStatus === 'awaiting_review' &&
                        expansion.expansionId && (
                          <ApproveDenyActions
                            id={item.outreachId}
                            expansionId={expansion.expansionId}
                          />
                        )}
                    </Flex>
                  </Flex>
                ))}
              </Flex>
            </Card>
          )}
        </Box>

        <Box width={{ initial: '100%', md: '320px' }} flexShrink="0">
          <Card>
            <Heading size="3" mb="2">
              Send details
            </Heading>
            <DataList.Root size="2">
              <DataList.Item>
                <DataList.Label>Audience</DataList.Label>
                <DataList.Value>
                  {AUDIENCE_LABELS[audienceKind]} ·{' '}
                  {item.textCount?.toLocaleString() ?? '—'} texts
                </DataList.Value>
              </DataList.Item>
              <DataList.Item>
                <DataList.Label>Send date</DataList.Label>
                <DataList.Value>{formatDateTime(item.sendAt)}</DataList.Value>
              </DataList.Item>
              {item.approvedAt && (
                <DataList.Item>
                  <DataList.Label>Approved</DataList.Label>
                  <DataList.Value>
                    {formatDate(item.approvedAt)} · {item.approvedBy}
                  </DataList.Value>
                </DataList.Item>
              )}
              {item.deniedAt && (
                <DataList.Item>
                  <DataList.Label>Denied</DataList.Label>
                  <DataList.Value>
                    {formatDate(item.deniedAt)} · {item.deniedBy}
                    {item.deniedReason ? `: ${item.deniedReason}` : ''}
                  </DataList.Value>
                </DataList.Item>
              )}
            </DataList.Root>
          </Card>

          {canDecide && awaiting && (
            <Box mt="4">
              <ApproveDenyActions id={item.outreachId} />
            </Box>
          )}
        </Box>
      </Flex>
    </Container>
  )
}
