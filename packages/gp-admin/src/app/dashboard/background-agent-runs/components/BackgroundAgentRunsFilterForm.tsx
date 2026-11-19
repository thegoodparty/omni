'use client'

import { useState } from 'react'
import { Box, Button, Flex, Select, Text, TextField } from '@radix-ui/themes'
import { HiX } from 'react-icons/hi'
import type { AgentRunStatus } from '@/shared/gpApi'
import {
  BACKGROUND_AGENT_RUN_STATUSES,
  SEARCH_PARAMS,
  SearchParamUpdates,
  isBackgroundAgentRunStatus,
} from '../types'

const STATUS_ANY = 'all'

interface BackgroundAgentRunsFilterFormProps {
  agentName?: string
  status?: AgentRunStatus
  organization?: string
  createdAfter?: string
  createdBefore?: string
  onApply: (updates: SearchParamUpdates) => void
}

export const BackgroundAgentRunsFilterForm = ({
  agentName,
  status,
  organization,
  createdAfter,
  createdBefore,
  onApply,
}: BackgroundAgentRunsFilterFormProps) => {
  const [agentNameValue, setAgentNameValue] = useState(agentName ?? '')
  const [statusValue, setStatusValue] = useState<string>(status ?? STATUS_ANY)
  const [organizationValue, setOrganizationValue] = useState(organization ?? '')
  const [createdAfterValue, setCreatedAfterValue] = useState(createdAfter ?? '')
  const [createdBeforeValue, setCreatedBeforeValue] = useState(
    createdBefore ?? ''
  )

  const hasActiveFilters = Boolean(
    agentName || status || organization || createdAfter || createdBefore
  )

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const trimmedAgent = agentNameValue.trim()
    const trimmedOrganization = organizationValue.trim()
    onApply({
      [SEARCH_PARAMS.AGENT_NAME]: trimmedAgent || undefined,
      [SEARCH_PARAMS.STATUS]:
        statusValue !== STATUS_ANY && isBackgroundAgentRunStatus(statusValue)
          ? statusValue
          : undefined,
      [SEARCH_PARAMS.ORGANIZATION]: trimmedOrganization || undefined,
      [SEARCH_PARAMS.CREATED_AFTER]: createdAfterValue || undefined,
      [SEARCH_PARAMS.CREATED_BEFORE]: createdBeforeValue || undefined,
    })
  }

  const handleClear = () => {
    setAgentNameValue('')
    setStatusValue(STATUS_ANY)
    setOrganizationValue('')
    setCreatedAfterValue('')
    setCreatedBeforeValue('')
    onApply({
      [SEARCH_PARAMS.AGENT_NAME]: undefined,
      [SEARCH_PARAMS.STATUS]: undefined,
      [SEARCH_PARAMS.ORGANIZATION]: undefined,
      [SEARCH_PARAMS.CREATED_AFTER]: undefined,
      [SEARCH_PARAMS.CREATED_BEFORE]: undefined,
    })
  }

  return (
    <Box asChild p="4" className="border border-[var(--gray-5)] rounded-lg">
      <form onSubmit={handleSubmit}>
        <Flex direction="column" gap="4">
          <Flex gap="4" wrap="wrap" align="end">
            <Box>
              <Text
                as="label"
                size="2"
                weight="medium"
                mb="1"
                htmlFor="agent-name"
              >
                Agent
              </Text>
              <TextField.Root
                id="agent-name"
                placeholder="e.g. trending_issues"
                value={agentNameValue}
                onChange={(e) => setAgentNameValue(e.target.value)}
              />
            </Box>

            <Box>
              <Text as="label" size="2" weight="medium" mb="1">
                Status
              </Text>
              <Select.Root value={statusValue} onValueChange={setStatusValue}>
                <Select.Trigger aria-label="Status" />
                <Select.Content>
                  <Select.Item value={STATUS_ANY}>All</Select.Item>
                  {BACKGROUND_AGENT_RUN_STATUSES.map((option) => (
                    <Select.Item key={option} value={option}>
                      {option}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Box>

            <Box>
              <Text
                as="label"
                size="2"
                weight="medium"
                mb="1"
                htmlFor="organization"
              >
                Organization
              </Text>
              <TextField.Root
                id="organization"
                placeholder="organization slug"
                value={organizationValue}
                onChange={(e) => setOrganizationValue(e.target.value)}
              />
            </Box>

            <Box>
              <Text
                as="label"
                size="2"
                weight="medium"
                mb="1"
                htmlFor="created-after"
              >
                Created after
              </Text>
              <TextField.Root
                id="created-after"
                type="date"
                value={createdAfterValue}
                onChange={(e) => setCreatedAfterValue(e.target.value)}
              />
            </Box>

            <Box>
              <Text
                as="label"
                size="2"
                weight="medium"
                mb="1"
                htmlFor="created-before"
              >
                Created before
              </Text>
              <TextField.Root
                id="created-before"
                type="date"
                value={createdBeforeValue}
                onChange={(e) => setCreatedBeforeValue(e.target.value)}
              />
            </Box>
          </Flex>

          <Flex gap="3">
            <Button type="submit">Apply filters</Button>
            {hasActiveFilters && (
              <Button
                type="button"
                variant="soft"
                color="gray"
                onClick={handleClear}
              >
                <HiX className="w-4 h-4" />
                Clear
              </Button>
            )}
          </Flex>
        </Flex>
      </form>
    </Box>
  )
}
