'use client'

import { TextField, Text, Box, Flex, Switch, Select } from '@radix-ui/themes'
import { useFormContext } from 'react-hook-form'
import type { CampaignFormData } from '../schema'
import { CAMPAIGN_TIERS, CAMPAIGN_LAUNCH_STATUS } from '../schema'
import { InfoCard } from '../../components/InfoCard'
import { ErrorText } from '@/components/ErrorText'
import {
  INPUT_TYPE,
  CAMPAIGN_FORM_SECTIONS,
  SELECT_NONE_VALUE,
} from '../constants'

type CampaignTier = (typeof CAMPAIGN_TIERS)[number]
type LaunchStatus = (typeof CAMPAIGN_LAUNCH_STATUS)[number]

type StatusFlagKey =
  | 'isActive'
  | 'isVerified'
  | 'isPro'
  | 'isDemo'
  | 'didWin'
  | 'canDownloadFederal'

interface StatusFlag {
  key: StatusFlagKey
  label: string
}

const STATUS_FLAGS: StatusFlag[] = [
  { key: 'isActive', label: 'Active' },
  { key: 'isVerified', label: 'Verified' },
  { key: 'isPro', label: 'Pro' },
  { key: 'isDemo', label: 'Demo' },
  { key: 'didWin', label: 'Won Election' },
  { key: 'canDownloadFederal', label: 'Can Download Federal' },
]

function isCampaignTier(value: string): value is CampaignTier {
  return CAMPAIGN_TIERS.includes(value as CampaignTier)
}

function isLaunchStatus(value: string): value is LaunchStatus {
  return CAMPAIGN_LAUNCH_STATUS.includes(value as LaunchStatus)
}

export function CampaignForm() {
  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<CampaignFormData>()

  function handleStatusFlagChange(key: StatusFlagKey, checked: boolean) {
    setValue(key, checked)
  }

  function handleTierChange(value: string) {
    if (value === SELECT_NONE_VALUE) {
      setValue('tier', null)
    } else if (isCampaignTier(value)) {
      setValue('tier', value)
    }
  }

  function handleLaunchStatusChange(value: string) {
    if (isLaunchStatus(value)) {
      setValue('data.launchStatus', value)
    }
  }

  return (
    <Flex direction="column" gap="4">
      <InfoCard title={CAMPAIGN_FORM_SECTIONS.STATUS}>
        <Flex direction="column" gap="4">
          {STATUS_FLAGS.map(({ key, label }) => (
            <Flex key={key} justify="between" align="center">
              <Text as="label" size="2" htmlFor={key}>
                {label}
              </Text>
              <Switch
                id={key}
                checked={watch(key) ?? false}
                onCheckedChange={(checked) =>
                  handleStatusFlagChange(key, checked)
                }
              />
            </Flex>
          ))}
        </Flex>
      </InfoCard>

      <InfoCard title={CAMPAIGN_FORM_SECTIONS.TIER}>
        <Flex direction="column" gap="1">
          <Text as="label" size="2" weight="medium">
            Tier
          </Text>
          <Select.Root
            value={watch('tier') ?? SELECT_NONE_VALUE}
            onValueChange={handleTierChange}
          >
            <Select.Trigger placeholder="Select tier..." />
            <Select.Content>
              <Select.Item value={SELECT_NONE_VALUE}>None</Select.Item>
              {CAMPAIGN_TIERS.map((tier) => (
                <Select.Item key={tier} value={tier}>
                  {tier}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
      </InfoCard>

      <InfoCard title={CAMPAIGN_FORM_SECTIONS.DATA}>
        <Flex direction="column" gap="4">
          <Box>
            <Text as="label" size="2" weight="medium" mb="1">
              Campaign Name
            </Text>
            <TextField.Root
              {...register('data.name')}
              placeholder="Campaign name"
            />
          </Box>

          <Flex direction="column" gap="1">
            <Text as="label" size="2" weight="medium">
              Launch Status
            </Text>
            <Select.Root
              value={watch('data.launchStatus') ?? ''}
              onValueChange={handleLaunchStatusChange}
            >
              <Select.Trigger placeholder="Select status..." />
              <Select.Content>
                {CAMPAIGN_LAUNCH_STATUS.map((status) => (
                  <Select.Item key={status} value={status}>
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>

          <Box>
            <Text as="label" size="2" weight="medium" mb="1">
              Admin User Email
            </Text>
            <TextField.Root
              {...register('data.adminUserEmail')}
              type={INPUT_TYPE.EMAIL}
              placeholder="admin@example.com"
              color={errors.data?.adminUserEmail ? 'red' : undefined}
            />
            {errors.data?.adminUserEmail && (
              <ErrorText>{errors.data.adminUserEmail.message}</ErrorText>
            )}
          </Box>
        </Flex>
      </InfoCard>
    </Flex>
  )
}
