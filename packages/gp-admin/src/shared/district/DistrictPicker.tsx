'use client'

import { useState, useEffect, useCallback } from 'react'
import { Text, Box, Flex, Select, Button, Checkbox } from '@radix-ui/themes'
import { useToast } from '@/components/Toast'
import { InfoCard } from '@/app/dashboard/users/[id]/components/InfoCard'
import { fetchDistrictTypes, fetchDistrictNames } from './district-actions'
import { DISTRICT_FORM_SECTION_TITLE } from '@/app/dashboard/users/[id]/edit/constants'
import type { DistrictTypeItem, DistrictNameItem } from '@goodparty_org/sdk'

const SELECT_NONE = '__none__'

export interface DistrictPickerProps {
  state: string
  electionYear: number
  initialL2DistrictType?: string
  initialL2DistrictName?: string
  /**
   * When true (default), the picker initially hides districts that have no
   * `projectedTurnout` available. Set to false for contexts (e.g. elected
   * offices) where projected turnout is not relevant and admins should be
   * able to pick any district.
   */
  defaultExcludeInvalid?: boolean
  onSave: (input: {
    L2DistrictType: string
    L2DistrictName: string
  }) => Promise<void>
  onDistrictSaved?: () => void
}

export function DistrictPicker({
  state,
  electionYear,
  initialL2DistrictType,
  initialL2DistrictName,
  defaultExcludeInvalid = true,
  onSave,
  onDistrictSaved,
}: DistrictPickerProps) {
  const { showToast } = useToast()

  const [types, setTypes] = useState<DistrictTypeItem[]>([])
  const [names, setNames] = useState<DistrictNameItem[]>([])
  const [selectedType, setSelectedType] = useState<string>(
    initialL2DistrictType ?? SELECT_NONE
  )
  const [selectedName, setSelectedName] = useState<string>(
    initialL2DistrictName ?? SELECT_NONE
  )
  const [loadingTypes, setLoadingTypes] = useState(false)
  const [loadingNames, setLoadingNames] = useState(false)
  const [saving, setSaving] = useState(false)
  const [excludeInvalid, setExcludeInvalid] = useState(defaultExcludeInvalid)

  const loadTypes = useCallback(async () => {
    if (!state || !electionYear) return
    setLoadingTypes(true)
    try {
      const data = await fetchDistrictTypes(state, electionYear, excludeInvalid)
      setTypes(data)
    } catch (error) {
      console.error('Failed to load district types:', error)
      setTypes([])
    } finally {
      setLoadingTypes(false)
    }
  }, [state, electionYear, excludeInvalid])

  const loadNames = useCallback(async () => {
    if (!selectedType || selectedType === SELECT_NONE) return
    setLoadingNames(true)
    try {
      const data = await fetchDistrictNames(
        state,
        electionYear,
        selectedType,
        excludeInvalid
      )
      setNames(data)
    } catch (error) {
      console.error('Failed to load district names:', error)
      setNames([])
    } finally {
      setLoadingNames(false)
    }
  }, [state, electionYear, selectedType, excludeInvalid])

  useEffect(() => {
    loadTypes()
  }, [loadTypes])

  useEffect(() => {
    loadNames()
  }, [loadNames])

  function handleTypeChange(value: string) {
    setSelectedType(value)
    setSelectedName(SELECT_NONE)
    setNames([])
  }

  async function handleSave() {
    if (
      !selectedType ||
      selectedType === SELECT_NONE ||
      !selectedName ||
      selectedName === SELECT_NONE
    )
      return

    setSaving(true)
    try {
      await onSave({
        L2DistrictType: selectedType,
        L2DistrictName: selectedName,
      })
      showToast('District updated')
      onDistrictSaved?.()
    } catch (error) {
      console.error('Failed to update district:', error)
      showToast('Failed to update district')
    } finally {
      setSaving(false)
    }
  }

  const canSave =
    selectedType !== SELECT_NONE && selectedName !== SELECT_NONE && !saving

  const hasNoState = !state
  const hasNoElectionYear = !electionYear

  if (hasNoState || hasNoElectionYear) {
    return (
      <InfoCard title={DISTRICT_FORM_SECTION_TITLE}>
        <Text size="2" color="gray">
          Missing {hasNoState ? 'state' : 'election date'} — cannot load
          districts.
        </Text>
      </InfoCard>
    )
  }

  return (
    <InfoCard title={DISTRICT_FORM_SECTION_TITLE}>
      <Flex direction="column" gap="4">
        <Flex gap="4" wrap="wrap">
          <Box flexGrow="1" style={{ minWidth: '200px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              District Type
            </Text>
            <Select.Root
              value={selectedType}
              onValueChange={handleTypeChange}
              disabled={loadingTypes}
            >
              <Select.Trigger
                placeholder={
                  loadingTypes ? 'Loading...' : 'Select district type...'
                }
                style={{ width: '100%' }}
              />
              <Select.Content>
                <Select.Item value={SELECT_NONE}>None</Select.Item>
                {types.map((type) => (
                  <Select.Item key={type.id} value={type.L2DistrictType}>
                    {type.L2DistrictType.replace(/_/g, ' ')}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Box>

          <Box flexGrow="1" style={{ minWidth: '200px' }}>
            <Text as="label" size="2" weight="medium" mb="1">
              District Name
            </Text>
            <Select.Root
              value={selectedName}
              onValueChange={setSelectedName}
              disabled={
                loadingNames || !selectedType || selectedType === SELECT_NONE
              }
            >
              <Select.Trigger
                placeholder={
                  loadingNames ? 'Loading...' : 'Select district name...'
                }
                style={{ width: '100%' }}
              />
              <Select.Content>
                <Select.Item value={SELECT_NONE}>None</Select.Item>
                {names.map((name) => (
                  <Select.Item key={name.id} value={name.L2DistrictName}>
                    {name.L2DistrictName}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Box>
        </Flex>

        <Flex align="center" gap="2">
          <Checkbox
            checked={!excludeInvalid}
            onCheckedChange={(checked) => setExcludeInvalid(!checked)}
          />
          <Text size="1" color="red">
            Show all districts (including those without projected turnout)
          </Text>
        </Flex>

        <Flex justify="end">
          <Button onClick={handleSave} disabled={!canSave} loading={saving}>
            Save District
          </Button>
        </Flex>
      </Flex>
    </InfoCard>
  )
}
