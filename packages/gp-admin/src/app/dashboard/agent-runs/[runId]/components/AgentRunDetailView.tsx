'use client'

import {
  Badge,
  Box,
  Card,
  Code,
  DataList,
  Flex,
  Heading,
  Text,
} from '@radix-ui/themes'
import {
  STATUS_BADGE_COLORS,
  STATUS_BADGE_LABELS,
  formatCost,
  formatDuration,
  formatTimestamp,
} from '../../types'
import {
  COMPLIANCE_SETUP_EXPERIMENT,
  parseComplianceSummary,
} from '../complianceSummary'
import { useAgentRun } from '../context/AgentRunContext'
import { RetryRunButton } from './RetryRunButton'

function ComplianceSummaryCard({
  artifact,
}: {
  artifact: Record<string, unknown>
}) {
  const { stage, domainName, peerlyStatus, blockers } =
    parseComplianceSummary(artifact)

  return (
    <Card>
      <Flex direction="column" gap="2">
        <Heading size="3">Compliance setup</Heading>
        <DataList.Root>
          <DataList.Item>
            <DataList.Label>Stage</DataList.Label>
            <DataList.Value>{stage ?? '—'}</DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label>Domain</DataList.Label>
            <DataList.Value>{domainName ?? '—'}</DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label>Peerly status</DataList.Label>
            <DataList.Value>{peerlyStatus ?? '—'}</DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label>Blockers</DataList.Label>
            <DataList.Value>
              {blockers.length > 0 ? blockers.join(', ') : 'None'}
            </DataList.Value>
          </DataList.Item>
        </DataList.Root>
      </Flex>
    </Card>
  )
}

export function AgentRunDetailView() {
  const { run, artifact, conversationLog } = useAgentRun()

  const showComplianceSummary =
    run.experimentType === COMPLIANCE_SETUP_EXPERIMENT && artifact !== null

  return (
    <Flex direction="column" gap="5">
      <Flex justify="between" align="start" gap="4" wrap="wrap">
        <Box>
          <Heading size="6" mb="2">
            {run.experimentType}
          </Heading>
          <Code variant="ghost" size="2">
            {run.runId}
          </Code>
        </Box>
        <RetryRunButton runId={run.runId} />
      </Flex>

      <Card>
        <DataList.Root>
          <DataList.Item>
            <DataList.Label>Status</DataList.Label>
            <DataList.Value>
              <Badge color={STATUS_BADGE_COLORS[run.status]}>
                {STATUS_BADGE_LABELS[run.status] ?? run.status}
              </Badge>
            </DataList.Value>
          </DataList.Item>
          {run.stage && (
            <DataList.Item>
              <DataList.Label>Stage</DataList.Label>
              <DataList.Value>{run.stage}</DataList.Value>
            </DataList.Item>
          )}
          {run.status === 'AWAITING_RESUME' && (
            <>
              <DataList.Item>
                <DataList.Label>Next resume</DataList.Label>
                <DataList.Value>
                  {run.resumeScheduledFor
                    ? formatTimestamp(run.resumeScheduledFor)
                    : '—'}
                </DataList.Value>
              </DataList.Item>
              <DataList.Item>
                <DataList.Label>Resume attempts</DataList.Label>
                <DataList.Value>{run.resumeAttempts}</DataList.Value>
              </DataList.Item>
            </>
          )}
          <DataList.Item>
            <DataList.Label>Organization</DataList.Label>
            <DataList.Value>{run.organizationSlug}</DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label>Duration</DataList.Label>
            <DataList.Value>
              {formatDuration(run.durationSeconds)}
            </DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label>Cost</DataList.Label>
            <DataList.Value>{formatCost(run.costUsd)}</DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label>Created</DataList.Label>
            <DataList.Value>{formatTimestamp(run.createdAt)}</DataList.Value>
          </DataList.Item>
          {run.error && (
            <DataList.Item>
              <DataList.Label>Error</DataList.Label>
              <DataList.Value>
                <Text color="red">{run.error}</Text>
              </DataList.Value>
            </DataList.Item>
          )}
        </DataList.Root>
      </Card>

      {showComplianceSummary && <ComplianceSummaryCard artifact={artifact} />}

      <Box>
        <Heading size="3" mb="2">
          Artifact
        </Heading>
        {artifact === null ? (
          <Text color="gray" size="2">
            No artifact yet. The run may still be in progress.
          </Text>
        ) : (
          <Box
            asChild
            p="3"
            className="bg-[var(--gray-2)] rounded-md overflow-auto max-h-[480px]"
          >
            <pre>
              <Code variant="ghost" size="1">
                {JSON.stringify(artifact, null, 2)}
              </Code>
            </pre>
          </Box>
        )}
      </Box>

      <Box>
        <Heading size="3" mb="2">
          Conversation log
        </Heading>
        {conversationLog === null ? (
          <Text color="gray" size="2">
            No conversation log available for this run.
          </Text>
        ) : (
          <Box
            asChild
            p="3"
            className="bg-[var(--gray-2)] rounded-md overflow-auto max-h-[480px]"
          >
            <pre>
              <Code variant="ghost" size="1">
                {conversationLog}
              </Code>
            </pre>
          </Box>
        )}
      </Box>
    </Flex>
  )
}
