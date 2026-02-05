'use client'

import {
  TextField,
  TextArea,
  Text,
  Box,
  Flex,
  Switch,
  Select,
  Separator,
} from '@radix-ui/themes'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigationGuard } from 'next-navigation-guard'
import { InfoCard } from '../../components/InfoCard'
import { ErrorText } from '@/components/ErrorText'
import { FormActions } from './FormActions'
import {
  campaignSchema,
  campaignDetailsSchema,
  CAMPAIGN_TIERS,
  CAMPAIGN_LAUNCH_STATUS,
  BALLOT_LEVELS,
  ELECTION_LEVELS,
} from '../schema'
import {
  INPUT_TYPE,
  CAMPAIGN_FORM_SECTIONS,
  SELECT_NONE_VALUE,
  FORM_MODE,
  UNSAVED_CHANGES_MESSAGE,
} from '../constants'
import type { Campaign } from '../../types/campaign'

// Combined schema for single form
const combinedCampaignSchema = z.object({
  ...campaignSchema.shape,
  details: campaignDetailsSchema,
})

type CombinedCampaignFormData = z.infer<typeof combinedCampaignSchema>

type CampaignTier = (typeof CAMPAIGN_TIERS)[number]
type LaunchStatus = (typeof CAMPAIGN_LAUNCH_STATUS)[number]
type BallotLevel = (typeof BALLOT_LEVELS)[number]
type ElectionLevel = (typeof ELECTION_LEVELS)[number]

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

function isBallotLevel(value: string): value is BallotLevel {
  return BALLOT_LEVELS.includes(value as BallotLevel)
}

function isElectionLevel(value: string): value is ElectionLevel {
  return ELECTION_LEVELS.includes(value as ElectionLevel)
}

interface CampaignEditFormProps {
  initialData: Campaign
  onSave: (data: CombinedCampaignFormData) => void
  onCancel: () => void
}

export function CampaignEditForm({
  initialData,
  onSave,
  onCancel,
}: CampaignEditFormProps) {
  const {
    register,
    watch,
    setValue,
    getValues,
    formState: { errors, isDirty, isValid },
  } = useForm<CombinedCampaignFormData>({
    mode: FORM_MODE.ON_CHANGE,
    resolver: zodResolver(combinedCampaignSchema),
    defaultValues: {
      isActive: initialData.isActive,
      isVerified: initialData.isVerified ?? false,
      isPro: initialData.isPro ?? false,
      isDemo: initialData.isDemo,
      didWin: initialData.didWin ?? false,
      tier: initialData.tier,
      canDownloadFederal: initialData.canDownloadFederal,
      data: {
        launchStatus: initialData.data.launchStatus,
        name: initialData.data.name ?? '',
        adminUserEmail: '',
      },
      details: {
        state: initialData.details.state ?? '',
        city: initialData.details.city ?? '',
        county: initialData.details.county ?? '',
        zip: initialData.details.zip ?? '',
        district: initialData.details.district ?? '',
        office: initialData.details.office ?? '',
        otherOffice: initialData.details.otherOffice ?? '',
        ballotLevel: initialData.details.ballotLevel,
        level: initialData.details.level ?? null,
        officeTermLength: initialData.details.officeTermLength ?? '',
        electionDate: initialData.details.electionDate ?? '',
        primaryElectionDate: initialData.details.primaryElectionDate ?? '',
        partisanType: initialData.details.partisanType ?? '',
        filingPeriodsStart: initialData.details.filingPeriodsStart ?? '',
        filingPeriodsEnd: initialData.details.filingPeriodsEnd ?? '',
        party: initialData.details.party ?? '',
        otherParty: initialData.details.otherParty ?? '',
        occupation: initialData.details.occupation ?? '',
        funFact: initialData.details.funFact ?? '',
        pastExperience:
          typeof initialData.details.pastExperience === 'string'
            ? initialData.details.pastExperience
            : '',
        website: initialData.details.website ?? '',
        pledged: initialData.details.pledged ?? false,
      },
    },
  })

  useNavigationGuard({
    enabled: isDirty,
    confirm: () => window.confirm(UNSAVED_CHANGES_MESSAGE),
  })

  function handleSubmit() {
    const data = getValues()
    const result = combinedCampaignSchema.safeParse(data)

    if (!result.success) {
      console.error('Validation errors:', result.error)
      return
    }

    onSave(data)
  }

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

  function handleBallotLevelChange(value: string) {
    if (isBallotLevel(value)) {
      setValue('details.ballotLevel', value)
    }
  }

  function handleElectionLevelChange(value: string) {
    if (value === SELECT_NONE_VALUE) {
      setValue('details.level', null)
    } else if (isElectionLevel(value)) {
      setValue('details.level', value)
    }
  }

  return (
    <>
      <Flex direction="column" gap="6">
        {/* Campaign Status Section */}
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

        {/* Campaign Details Section */}
        <Flex direction="column" gap="4">
          <InfoCard title={CAMPAIGN_FORM_SECTIONS.LOCATION}>
            <Flex direction="column" gap="4">
              <Flex gap="4" wrap="wrap">
                <Box flexGrow="1" style={{ minWidth: '200px' }}>
                  <Text as="label" size="2" weight="medium" mb="1">
                    State
                  </Text>
                  <TextField.Root
                    {...register('details.state')}
                    placeholder="State"
                  />
                </Box>
                <Box flexGrow="1" style={{ minWidth: '200px' }}>
                  <Text as="label" size="2" weight="medium" mb="1">
                    City
                  </Text>
                  <TextField.Root
                    {...register('details.city')}
                    placeholder="City"
                  />
                </Box>
              </Flex>

              <Flex gap="4" wrap="wrap">
                <Box flexGrow="1" style={{ minWidth: '200px' }}>
                  <Text as="label" size="2" weight="medium" mb="1">
                    County
                  </Text>
                  <TextField.Root
                    {...register('details.county')}
                    placeholder="County"
                  />
                </Box>
                <Box flexGrow="1" style={{ minWidth: '150px' }}>
                  <Text as="label" size="2" weight="medium" mb="1">
                    ZIP
                  </Text>
                  <TextField.Root
                    {...register('details.zip')}
                    placeholder="ZIP"
                  />
                </Box>
              </Flex>

              <Box>
                <Text as="label" size="2" weight="medium" mb="1">
                  District
                </Text>
                <TextField.Root
                  {...register('details.district')}
                  placeholder="District"
                />
              </Box>
            </Flex>
          </InfoCard>

          <InfoCard title={CAMPAIGN_FORM_SECTIONS.OFFICE}>
            <Flex direction="column" gap="4">
              <Flex gap="4" wrap="wrap">
                <Box flexGrow="1" style={{ minWidth: '200px' }}>
                  <Text as="label" size="2" weight="medium" mb="1">
                    Office
                  </Text>
                  <TextField.Root
                    {...register('details.office')}
                    placeholder="Office"
                  />
                </Box>
                <Box flexGrow="1" style={{ minWidth: '200px' }}>
                  <Text as="label" size="2" weight="medium" mb="1">
                    Other Office
                  </Text>
                  <TextField.Root
                    {...register('details.otherOffice')}
                    placeholder="Other office"
                  />
                </Box>
              </Flex>

              <Flex gap="4" wrap="wrap">
                <Flex
                  direction="column"
                  gap="1"
                  flexGrow="1"
                  style={{ minWidth: '200px' }}
                >
                  <Text as="label" size="2" weight="medium">
                    Ballot Level
                  </Text>
                  <Select.Root
                    value={watch('details.ballotLevel') ?? ''}
                    onValueChange={handleBallotLevelChange}
                  >
                    <Select.Trigger placeholder="Select level..." />
                    <Select.Content>
                      {BALLOT_LEVELS.map((level) => (
                        <Select.Item key={level} value={level}>
                          {level}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </Flex>
                <Flex
                  direction="column"
                  gap="1"
                  flexGrow="1"
                  style={{ minWidth: '200px' }}
                >
                  <Text as="label" size="2" weight="medium">
                    Election Level
                  </Text>
                  <Select.Root
                    value={watch('details.level') ?? SELECT_NONE_VALUE}
                    onValueChange={handleElectionLevelChange}
                  >
                    <Select.Trigger placeholder="Select level..." />
                    <Select.Content>
                      <Select.Item value={SELECT_NONE_VALUE}>None</Select.Item>
                      {ELECTION_LEVELS.map((level) => (
                        <Select.Item key={level} value={level}>
                          {level.charAt(0).toUpperCase() + level.slice(1)}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </Flex>
              </Flex>

              <Box>
                <Text as="label" size="2" weight="medium" mb="1">
                  Term Length
                </Text>
                <TextField.Root
                  {...register('details.officeTermLength')}
                  placeholder="e.g., 4 years"
                />
              </Box>
            </Flex>
          </InfoCard>

          <InfoCard title={CAMPAIGN_FORM_SECTIONS.ELECTION}>
            <Flex direction="column" gap="4">
              <Flex gap="4" wrap="wrap">
                <Box flexGrow="1" style={{ minWidth: '200px' }}>
                  <Text as="label" size="2" weight="medium" mb="1">
                    Election Date
                  </Text>
                  <TextField.Root
                    {...register('details.electionDate')}
                    type={INPUT_TYPE.DATE}
                  />
                </Box>
                <Box flexGrow="1" style={{ minWidth: '200px' }}>
                  <Text as="label" size="2" weight="medium" mb="1">
                    Primary Election Date
                  </Text>
                  <TextField.Root
                    {...register('details.primaryElectionDate')}
                    type={INPUT_TYPE.DATE}
                  />
                </Box>
              </Flex>

              <Box>
                <Text as="label" size="2" weight="medium" mb="1">
                  Partisan Type
                </Text>
                <TextField.Root
                  {...register('details.partisanType')}
                  placeholder="e.g., partisan, nonpartisan"
                />
              </Box>
            </Flex>
          </InfoCard>

          <InfoCard title={CAMPAIGN_FORM_SECTIONS.FILING_PERIOD}>
            <Flex gap="4" wrap="wrap">
              <Box flexGrow="1" style={{ minWidth: '200px' }}>
                <Text as="label" size="2" weight="medium" mb="1">
                  Filing Start
                </Text>
                <TextField.Root
                  {...register('details.filingPeriodsStart')}
                  type={INPUT_TYPE.DATE}
                />
              </Box>
              <Box flexGrow="1" style={{ minWidth: '200px' }}>
                <Text as="label" size="2" weight="medium" mb="1">
                  Filing End
                </Text>
                <TextField.Root
                  {...register('details.filingPeriodsEnd')}
                  type={INPUT_TYPE.DATE}
                />
              </Box>
            </Flex>
          </InfoCard>

          <InfoCard title={CAMPAIGN_FORM_SECTIONS.PARTY}>
            <Flex gap="4" wrap="wrap">
              <Box flexGrow="1" style={{ minWidth: '200px' }}>
                <Text as="label" size="2" weight="medium" mb="1">
                  Party
                </Text>
                <TextField.Root
                  {...register('details.party')}
                  placeholder="Party"
                />
              </Box>
              <Box flexGrow="1" style={{ minWidth: '200px' }}>
                <Text as="label" size="2" weight="medium" mb="1">
                  Other Party
                </Text>
                <TextField.Root
                  {...register('details.otherParty')}
                  placeholder="Other party"
                />
              </Box>
            </Flex>
          </InfoCard>

          <InfoCard title={CAMPAIGN_FORM_SECTIONS.BACKGROUND}>
            <Flex direction="column" gap="4">
              <Box>
                <Text as="label" size="2" weight="medium" mb="1">
                  Occupation
                </Text>
                <TextField.Root
                  {...register('details.occupation')}
                  placeholder="Occupation"
                />
              </Box>

              <Box>
                <Text as="label" size="2" weight="medium" mb="1">
                  Website
                </Text>
                <TextField.Root
                  {...register('details.website')}
                  placeholder="https://..."
                  color={errors.details?.website ? 'red' : undefined}
                />
                {errors.details?.website && (
                  <ErrorText>{errors.details.website.message}</ErrorText>
                )}
              </Box>

              <Box>
                <Text as="label" size="2" weight="medium" mb="1">
                  Fun Fact
                </Text>
                <TextArea
                  {...register('details.funFact')}
                  placeholder="Fun fact..."
                  rows={3}
                />
              </Box>

              <Box>
                <Text as="label" size="2" weight="medium" mb="1">
                  Past Experience
                </Text>
                <TextArea
                  {...register('details.pastExperience')}
                  placeholder="Past experience..."
                  rows={3}
                />
              </Box>

              <Flex justify="between" align="center">
                <Text as="label" size="2">
                  Pledged
                </Text>
                <Switch
                  checked={watch('details.pledged') ?? false}
                  onCheckedChange={(checked) =>
                    setValue('details.pledged', checked)
                  }
                />
              </Flex>
            </Flex>
          </InfoCard>
        </Flex>
      </Flex>

      <Separator size="4" my="6" />

      <FormActions
        onCancel={onCancel}
        onSubmit={handleSubmit}
        isValid={isValid}
        isDirty={isDirty}
      />
    </>
  )
}

export type { CombinedCampaignFormData }
