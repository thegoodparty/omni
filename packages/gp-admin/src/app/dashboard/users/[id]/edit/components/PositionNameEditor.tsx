'use client'

import { useState } from 'react'
import { Box, Button, Flex, Text, TextField } from '@radix-ui/themes'
import { useToast } from '@/components/Toast'
import { updateOrganizationPositionName } from '@/app/dashboard/organizations/actions'

interface PositionNameEditorProps {
  organizationSlug: string
  campaignId: number
  userId: number
  initialCustomPositionName: string | null
  structuredPositionName: string | null
}

export function PositionNameEditor({
  organizationSlug,
  campaignId,
  userId,
  initialCustomPositionName,
  structuredPositionName,
}: PositionNameEditorProps) {
  const { showToast } = useToast()
  const [value, setValue] = useState(initialCustomPositionName ?? '')
  const [savedValue, setSavedValue] = useState(initialCustomPositionName ?? '')
  const [saving, setSaving] = useState(false)

  const isDirty = value.trim() !== savedValue

  async function handleSave() {
    const trimmed = value.trim()
    setSaving(true)
    try {
      await updateOrganizationPositionName(
        organizationSlug,
        trimmed || null,
        campaignId,
        userId
      )
      setValue(trimmed)
      setSavedValue(trimmed)
      showToast('Position updated')
    } catch (error) {
      console.error('Failed to update position:', error)
      showToast('Failed to update position')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Box>
      <Text as="label" size="2" weight="medium" mb="1">
        Position
      </Text>
      <Flex gap="2">
        <Box flexGrow="1">
          <TextField.Root
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={
              structuredPositionName ?? 'e.g. City Council - District 1'
            }
          />
        </Box>
        <Button
          onClick={handleSave}
          disabled={!isDirty || saving}
          loading={saving}
        >
          Save Position
        </Button>
      </Flex>
      <Text as="p" size="1" color="gray" mt="1">
        {structuredPositionName
          ? `Overrides the structured position ("${structuredPositionName}") ` +
            'when set. Clear and save to fall back to it.'
          : 'No structured position is linked to this organization; this ' +
            'name is the office title synced to HubSpot.'}
      </Text>
    </Box>
  )
}
