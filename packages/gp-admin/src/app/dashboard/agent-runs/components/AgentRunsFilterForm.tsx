'use client'

import { useState } from 'react'
import { Box, Button, Flex, Select, Text, TextField } from '@radix-ui/themes'
import { HiX } from 'react-icons/hi'
import type { ExperimentRunStatus } from '@goodparty_org/sdk'
import {
  AGENT_RUN_STATUSES,
  SEARCH_PARAMS,
  SearchParamUpdates,
  isAgentRunStatus,
} from '../types'

const STATUS_ANY = 'all'

interface AgentRunsFilterFormProps {
  experimentType?: string
  status?: ExperimentRunStatus
  organization?: string
  createdAfter?: string
  createdBefore?: string
  onApply: (updates: SearchParamUpdates) => void
}

export function AgentRunsFilterForm({
  experimentType,
  status,
  organization,
  createdAfter,
  createdBefore,
  onApply,
}: AgentRunsFilterFormProps) {
  const [experimentTypeValue, setExperimentTypeValue] = useState(
    experimentType ?? ''
  )
  const [statusValue, setStatusValue] = useState<string>(status ?? STATUS_ANY)
  const [organizationValue, setOrganizationValue] = useState(organization ?? '')
  const [createdAfterValue, setCreatedAfterValue] = useState(createdAfter ?? '')
  const [createdBeforeValue, setCreatedBeforeValue] = useState(
    createdBefore ?? ''
  )

  const hasActiveFilters = Boolean(
    experimentType || status || organization || createdAfter || createdBefore
  )

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const trimmedExperiment = experimentTypeValue.trim()
    const trimmedOrganization = organizationValue.trim()
    onApply({
      [SEARCH_PARAMS.EXPERIMENT_TYPE]: trimmedExperiment || undefined,
      [SEARCH_PARAMS.STATUS]:
        statusValue !== STATUS_ANY && isAgentRunStatus(statusValue)
          ? statusValue
          : undefined,
      [SEARCH_PARAMS.ORGANIZATION]: trimmedOrganization || undefined,
      [SEARCH_PARAMS.CREATED_AFTER]: createdAfterValue || undefined,
      [SEARCH_PARAMS.CREATED_BEFORE]: createdBeforeValue || undefined,
    })
  }

  const handleClear = () => {
    setExperimentTypeValue('')
    setStatusValue(STATUS_ANY)
    setOrganizationValue('')
    setCreatedAfterValue('')
    setCreatedBeforeValue('')
    onApply({
      [SEARCH_PARAMS.EXPERIMENT_TYPE]: undefined,
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
                htmlFor="experiment-type"
              >
                Experiment type
              </Text>
              <TextField.Root
                id="experiment-type"
                placeholder="e.g. compliance_setup"
                value={experimentTypeValue}
                onChange={(e) => setExperimentTypeValue(e.target.value)}
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
                  {AGENT_RUN_STATUSES.map((option) => (
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
