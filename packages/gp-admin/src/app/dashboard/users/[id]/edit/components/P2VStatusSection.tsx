'use client'

import { TextField, Text, Box, Flex, Select } from '@radix-ui/themes'
import { type UseFormWatch, type UseFormSetValue } from 'react-hook-form'
import { type PathToVictoryFormData } from '../schema'
import { P2V_STATUS, P2V_STATUS_SET } from '../../constants'
import { type P2VStatus } from '@goodparty_org/sdk'
import { SELECT_NONE_VALUE } from '../constants'
import { DistrictPicker } from './DistrictPicker'

function isP2VStatus(value: string): value is P2VStatus {
  return P2V_STATUS_SET.has(value)
}

interface P2VStatusSectionProps {
  watch: UseFormWatch<PathToVictoryFormData>
  setValue: UseFormSetValue<PathToVictoryFormData>
  district?: {
    state: string
    electionYear: number
    campaignId: number
    userId: number
    initialElectionType?: string
    initialElectionLocation?: string
    onDistrictSaved?: () => void
  }
}

export function P2VStatusSection({
  watch,
  setValue,
  district,
}: P2VStatusSectionProps) {
  function handleStatusChange(value: string) {
    if (isP2VStatus(value)) {
      setValue('p2vStatus', value, { shouldDirty: true })
    } else {
      setValue('p2vStatus', undefined, { shouldDirty: true })
    }
  }

  return (
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="1">
        <Text as="label" size="2" weight="medium">
          Status
        </Text>
        <Select.Root
          value={watch('p2vStatus') ?? SELECT_NONE_VALUE}
          onValueChange={handleStatusChange}
        >
          <Select.Trigger placeholder="Select status..." />
          <Select.Content>
            <Select.Item value={SELECT_NONE_VALUE}>None</Select.Item>
            {P2V_STATUS.map((status) => (
              <Select.Item key={status} value={status}>
                {status}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>

      {district && (
        <DistrictPicker
          state={district.state}
          electionYear={district.electionYear}
          campaignId={district.campaignId}
          userId={district.userId}
          initialElectionType={district.initialElectionType}
          initialElectionLocation={district.initialElectionLocation}
          onDistrictSaved={district.onDistrictSaved}
        />
      )}

      <Flex gap="4" wrap="wrap">
        <Box flexGrow="1" style={{ minWidth: '200px' }}>
          <Text as="label" size="2" weight="medium" mb="1">
            Election Type
          </Text>
          <TextField.Root
            value={watch('electionType') ?? ''}
            disabled
            placeholder="Set via District Picker"
          />
        </Box>
        <Box flexGrow="1" style={{ minWidth: '200px' }}>
          <Text as="label" size="2" weight="medium" mb="1">
            Election Location
          </Text>
          <TextField.Root
            value={watch('electionLocation') ?? ''}
            disabled
            placeholder="Set via District Picker"
          />
        </Box>
      </Flex>
    </Flex>
  )
}
