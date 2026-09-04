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
import { formatDate } from '@/lib/utils/date'
import { getSmsDetail } from '../actions'
import { STANDARDS_RULE_LABELS, STATUS_COLORS, STATUS_LABELS } from '../types'
import { ApproveDenyActions } from '../components/ApproveDenyActions'
import { CancelAction } from '../components/CancelAction'
import { EditMessageAction } from '../components/EditMessageAction'

export const metadata: Metadata = {
  title: 'SMS Campaign Review | GP Admin',
}

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

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
    detail = await getSmsDetail(id)
  } catch {
    notFound()
  }
  const { item, stats } = detail

  return (
    <Container size="3">
      <Link
        href="/dashboard/sms-outreach"
        className="text-[var(--accent-11)] hover:underline"
      >
        ← SMS outreach queue
      </Link>

      <Flex align="center" gap="3" mt="3" mb="1">
        <Heading size="6">{item.name ?? `Campaign ${item.id}`}</Heading>
        <Badge color={STATUS_COLORS[item.approvalStatus]} size="2">
          {STATUS_LABELS[item.approvalStatus]}
        </Badge>
      </Flex>
      <Text color="gray" size="2">
        {item.candidateName ?? 'Unknown candidate'} · {item.campaignSlug}
      </Text>

      <Flex gap="4" mt="4" direction={{ initial: 'column', md: 'row' }}>
        <Box flexGrow="1" style={{ minWidth: 0 }}>
          <Card>
            <Heading size="3" mb="2">
              Message as it will send
            </Heading>
            {item.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.imageUrl}
                alt="Campaign attachment"
                style={{
                  maxHeight: 240,
                  borderRadius: 8,
                  marginBottom: 12,
                  maxWidth: '100%',
                }}
              />
            )}
            <Text size="2" style={{ whiteSpace: 'pre-wrap' }}>
              {item.script ?? '—'}
            </Text>
            {canDecide && item.script && item.approvalStatus !== 'canceled' && (
              <Box mt="3">
                <EditMessageAction id={item.id} script={item.script} />
              </Box>
            )}
            {item.adminEditedAt && (
              <Text size="1" color="gray" mt="2" as="p">
                Edited by {item.adminEditedBy} on{' '}
                {formatDate(item.adminEditedAt)}
              </Text>
            )}
          </Card>

          <Card mt="4">
            <Heading size="3" mb="2">
              Standards check
            </Heading>
            {item.standards === null ? (
              <Text size="2" color="gray">
                No message recorded.
              </Text>
            ) : item.standards.passed ? (
              <Badge color="green">All checks pass</Badge>
            ) : (
              <Flex direction="column" gap="1">
                {item.standards.failures.map((rule) => (
                  <Text key={rule} size="2" color="red">
                    • {STANDARDS_RULE_LABELS[rule]}
                  </Text>
                ))}
                <Text size="1" color="gray" mt="1">
                  Advisory — approval is still yours to make.
                </Text>
              </Flex>
            )}
          </Card>
        </Box>

        <Box width={{ initial: '100%', md: '320px' }} flexShrink="0">
          <Card>
            <Heading size="3" mb="2">
              Send details
            </Heading>
            <DataList.Root size="2">
              <DataList.Item>
                <DataList.Label>Assigned to</DataList.Label>
                <DataList.Value>
                  {item.assignedPa ?? 'Unassigned'}
                </DataList.Value>
              </DataList.Item>
              <DataList.Item>
                <DataList.Label>Send date</DataList.Label>
                <DataList.Value>
                  {item.sendAt ? formatDate(item.sendAt) : '—'}
                </DataList.Value>
              </DataList.Item>
              <DataList.Item>
                <DataList.Label>Audience</DataList.Label>
                <DataList.Value>
                  {(
                    item.billableTextCount ?? item.textCount
                  )?.toLocaleString() ?? '—'}{' '}
                  {item.paid ? '(paid)' : '(free texts)'}
                </DataList.Value>
              </DataList.Item>
              <DataList.Item>
                <DataList.Label>Vendor job</DataList.Label>
                <DataList.Value>
                  {item.job === null ? (
                    'Live read failed'
                  ) : item.job.deliverabilityCheckError ? (
                    <Text color="red">{item.job.deliverabilityCheckError}</Text>
                  ) : (
                    `${item.job.status}${
                      item.job.peerlyApproved ? ' · vendor approved' : ''
                    }`
                  )}
                </DataList.Value>
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
                    {item.deniedReason ? ` — ${item.deniedReason}` : ''}
                  </DataList.Value>
                </DataList.Item>
              )}
              {item.canceledAt && (
                <DataList.Item>
                  <DataList.Label>Canceled</DataList.Label>
                  <DataList.Value>
                    {formatDate(item.canceledAt)} ·{' '}
                    {item.canceledByAdmin
                      ? `${item.canceledBy ?? 'staff'} (staff)`
                      : item.canceledBy
                        ? `${item.canceledBy} (candidate)`
                        : 'candidate'}
                  </DataList.Value>
                </DataList.Item>
              )}
            </DataList.Root>
          </Card>

          {stats && (
            <Card mt="4">
              <Heading size="3" mb="2">
                Delivery
              </Heading>
              <DataList.Root size="2">
                <DataList.Item>
                  <DataList.Label>Sent</DataList.Label>
                  <DataList.Value>
                    {stats.sentTotal.toLocaleString()}
                  </DataList.Value>
                </DataList.Item>
                <DataList.Item>
                  <DataList.Label>Delivered</DataList.Label>
                  <DataList.Value>
                    {stats.delivered.toLocaleString()}
                  </DataList.Value>
                </DataList.Item>
                <DataList.Item>
                  <DataList.Label>Failed</DataList.Label>
                  <DataList.Value>
                    {stats.deliveryFailed.toLocaleString()}
                  </DataList.Value>
                </DataList.Item>
                <DataList.Item>
                  <DataList.Label>Replies</DataList.Label>
                  <DataList.Value>
                    {stats.receivedTotal.toLocaleString()}
                  </DataList.Value>
                </DataList.Item>
                <DataList.Item>
                  <DataList.Label>Vendor cost</DataList.Label>
                  <DataList.Value>${stats.totalCost.toFixed(2)}</DataList.Value>
                </DataList.Item>
              </DataList.Root>
            </Card>
          )}

          {canDecide && item.approvalStatus === 'awaiting_review' && (
            <Box mt="4">
              <ApproveDenyActions id={item.id} />
            </Box>
          )}
          {canDecide && item.approvalStatus !== 'canceled' && (
            <Box mt="4">
              <CancelAction id={item.id} paid={item.paid} />
            </Box>
          )}
        </Box>
      </Flex>
    </Container>
  )
}
