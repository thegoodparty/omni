'use client'

import { Box, Code, DataList, Heading, Text } from '@radix-ui/themes'
import type {
  BackgroundAgentMessage,
  BackgroundAgentRunDetail,
} from '@/shared/gpApi'
import { formatTimestamp, formatTokens } from '../../types'
import {
  messageText,
  messageToolCalls,
  messageToolResults,
} from '../transcript'

const CASCADED = 'bg-[var(--gray-2)] rounded-md p-3 overflow-auto'

const Collapsible = ({
  summary,
  children,
}: {
  summary: string
  children: React.ReactNode
}) => (
  <details className="border border-[var(--gray-5)] rounded-md">
    <summary className="cursor-pointer px-3 py-2 text-sm">{summary}</summary>
    <Box className="px-3 pb-3">{children}</Box>
  </details>
)

const ToolDetails = ({ message }: { message: BackgroundAgentMessage }) => {
  const calls = messageToolCalls(message)
  const results = messageToolResults(message)

  return (
    <div className="flex flex-col gap-2">
      {calls.map((call) => (
        <Collapsible
          key={call.toolCallId || call.toolName}
          summary={`Call ${call.toolName}`}
        >
          <pre className="text-xs overflow-auto">
            <Code variant="ghost" size="1">
              {call.input}
            </Code>
          </pre>
        </Collapsible>
      ))}
      {results.map((result) => (
        <Collapsible
          key={result.toolCallId || result.toolName}
          summary={`Result ${result.toolName}`}
        >
          <pre className="text-xs overflow-auto">
            <Code variant="ghost" size="1">
              {result.output}
            </Code>
          </pre>
        </Collapsible>
      ))}
    </div>
  )
}

const MessageBlock = ({ message }: { message: BackgroundAgentMessage }) => {
  const text = messageText(message)
  const hasTools =
    messageToolCalls(message).length > 0 ||
    messageToolResults(message).length > 0

  return (
    <div className="flex flex-col gap-2 border-l-2 border-[var(--gray-5)] pl-3">
      <Text size="1" color="gray">
        #{message.index} · {message.role}
        {message.model ? ` · ${message.model}` : ''}
        {message.inputTokens !== null
          ? ` · ${formatTokens(message.inputTokens)} in / ${formatTokens(
              message.outputTokens
            )} out`
          : ''}
      </Text>
      {text && (
        <Text size="2" className="whitespace-pre-wrap">
          {text}
        </Text>
      )}
      {hasTools && <ToolDetails message={message} />}
    </div>
  )
}

export const BackgroundAgentRunDetailView = ({
  detail,
}: {
  detail: BackgroundAgentRunDetail
}) => (
  <div className="flex flex-col gap-5">
    <div>
      <Heading size="6" mb="2">
        {detail.agentName}
      </Heading>
      <Code variant="ghost" size="2">
        {detail.runId}
      </Code>
    </div>

    <Box p="4" className="border border-[var(--gray-5)] rounded-lg">
      <DataList.Root>
        <DataList.Item>
          <DataList.Label>Status</DataList.Label>
          <DataList.Value>{detail.status}</DataList.Value>
        </DataList.Item>
        <DataList.Item>
          <DataList.Label>Organization</DataList.Label>
          <DataList.Value>{detail.organizationSlug}</DataList.Value>
        </DataList.Item>
        <DataList.Item>
          <DataList.Label>Shape hash</DataList.Label>
          <DataList.Value>
            <Code variant="ghost" size="1">
              {detail.shapeHash}
            </Code>
          </DataList.Value>
        </DataList.Item>
        <DataList.Item>
          <DataList.Label>Created</DataList.Label>
          <DataList.Value>{formatTimestamp(detail.createdAt)}</DataList.Value>
        </DataList.Item>
        <DataList.Item>
          <DataList.Label>Started</DataList.Label>
          <DataList.Value>{formatTimestamp(detail.startedAt)}</DataList.Value>
        </DataList.Item>
        <DataList.Item>
          <DataList.Label>Finished</DataList.Label>
          <DataList.Value>{formatTimestamp(detail.finishedAt)}</DataList.Value>
        </DataList.Item>
        {detail.error && (
          <DataList.Item>
            <DataList.Label>Error</DataList.Label>
            <DataList.Value>
              <Text color="red">{detail.error}</Text>
            </DataList.Value>
          </DataList.Item>
        )}
      </DataList.Root>
    </Box>

    <Box>
      <Heading size="3" mb="2">
        Input
      </Heading>
      <pre className={CASCADED}>
        <Code variant="ghost" size="1">
          {JSON.stringify(detail.input, null, 2)}
        </Code>
      </pre>
    </Box>

    <Box>
      <Heading size="3" mb="2">
        Artifact
      </Heading>
      {detail.artifact === null ? (
        <Text color="gray" size="2">
          No artifact yet. The run may still be in progress.
        </Text>
      ) : (
        <pre className={CASCADED}>
          <Code variant="ghost" size="1">
            {JSON.stringify(detail.artifact, null, 2)}
          </Code>
        </pre>
      )}
    </Box>

    <Box>
      <Heading size="3" mb="2">
        Transcript
      </Heading>
      {detail.messages.length === 0 ? (
        <Text color="gray" size="2">
          No messages recorded for this run.
        </Text>
      ) : (
        <div className="flex flex-col gap-3">
          {detail.messages.map((message) => (
            <MessageBlock key={message.index} message={message} />
          ))}
        </div>
      )}
    </Box>
  </div>
)
