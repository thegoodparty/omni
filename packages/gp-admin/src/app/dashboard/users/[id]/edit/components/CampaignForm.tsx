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
import { useForm, type Path } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigationGuard } from 'next-navigation-guard'
import { InfoCard } from '../../components/InfoCard'
import { ErrorText } from '@/components/ErrorText'
import { FormActions } from './FormActions'
import {
  combinedCampaignSchema,
  type CombinedCampaignFormData,
} from '../schema'
import {
  CampaignTier,
  CampaignLaunchStatus,
  BallotReadyPositionLevel,
  ElectionLevel,
} from '@goodparty_org/sdk'
import type { Campaign } from '@goodparty_org/sdk'
import {
  FORM_MODE,
  INPUT_TYPE,
  CAMPAIGN_FORM_SECTIONS,
  SELECT_NONE_VALUE,
  UNSAVED_CHANGES_MESSAGE,
  type InputType,
} from '../constants'

type FieldPath = Path<CombinedCampaignFormData>

interface FieldConfig {
  key: FieldPath
  label: string
  placeholder: string
  type?: InputType
  hasError?: boolean
}

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

const LOCATION_FIELDS: FieldConfig[] = [
  { key: 'details.state', label: 'State', placeholder: 'State' },
  { key: 'details.city', label: 'City', placeholder: 'City' },
  { key: 'details.county', label: 'County', placeholder: 'County' },
  { key: 'details.zip', label: 'ZIP', placeholder: 'ZIP' },
  { key: 'details.district', label: 'District', placeholder: 'District' },
]

const OFFICE_TEXT_FIELDS: FieldConfig[] = [
  { key: 'details.office', label: 'Office', placeholder: 'Office' },
  {
    key: 'details.otherOffice',
    label: 'Other Office',
    placeholder: 'Other office',
  },
  {
    key: 'details.officeTermLength',
    label: 'Term Length',
    placeholder: 'e.g., 4 years',
  },
]

const ELECTION_FIELDS: FieldConfig[] = [
  {
    key: 'details.electionDate',
    label: 'Election Date',
    placeholder: '',
    type: INPUT_TYPE.DATE,
  },
  {
    key: 'details.primaryElectionDate',
    label: 'Primary Election Date',
    placeholder: '',
    type: INPUT_TYPE.DATE,
  },
  {
    key: 'details.partisanType',
    label: 'Partisan Type',
    placeholder: 'e.g., partisan, nonpartisan',
  },
]

const FILING_PERIOD_FIELDS: FieldConfig[] = [
  {
    key: 'details.filingPeriodsStart',
    label: 'Filing Start',
    placeholder: '',
    type: INPUT_TYPE.DATE,
  },
  {
    key: 'details.filingPeriodsEnd',
    label: 'Filing End',
    placeholder: '',
    type: INPUT_TYPE.DATE,
  },
]

const PARTY_FIELDS: FieldConfig[] = [
  { key: 'details.party', label: 'Party', placeholder: 'Party' },
  {
    key: 'details.otherParty',
    label: 'Other Party',
    placeholder: 'Other party',
  },
]

const BACKGROUND_TEXT_FIELDS: FieldConfig[] = [
  {
    key: 'details.occupation',
    label: 'Occupation',
    placeholder: 'Occupation',
  },
  {
    key: 'details.website',
    label: 'Website',
    placeholder: 'https://...',
    hasError: true,
  },
]

function isCampaignTier(value: string): value is CampaignTier {
  return Object.values(CampaignTier).includes(value as CampaignTier)
}

function isLaunchStatus(value: string): value is CampaignLaunchStatus {
  return Object.values(CampaignLaunchStatus).includes(
    value as CampaignLaunchStatus
  )
}

function isBallotLevel(value: string): value is BallotReadyPositionLevel {
  return Object.values(BallotReadyPositionLevel).includes(
    value as BallotReadyPositionLevel
  )
}

function isElectionLevel(value: string): value is ElectionLevel {
  return Object.values(ElectionLevel).includes(value as ElectionLevel)
}

interface CampaignFormProps {
  initialData: Campaign
  onSave: (data: CombinedCampaignFormData) => void | Promise<void>
  onCancel: () => void
  isSaving?: boolean
}

export function CampaignForm({
  initialData,
  onSave,
  onCancel,
  isSaving,
}: CampaignFormProps) {
  const {
    isActive,
    isVerified,
    isPro,
    isDemo,
    didWin,
    tier,
    canDownloadFederal,
  } = initialData
  const data = initialData.data ?? {}
  const details = initialData.details ?? {}

  const {
    register,
    watch,
    setValue,
    getValues,
    reset,
    formState: { errors, isDirty, isValid },
  } = useForm<CombinedCampaignFormData>({
    mode: FORM_MODE.ON_CHANGE,
    resolver: zodResolver(combinedCampaignSchema),
    defaultValues: {
      isActive,
      isVerified: isVerified ?? false,
      isPro: isPro ?? false,
      isDemo,
      didWin: didWin ?? false,
      tier,
      canDownloadFederal,
      data: {
        launchStatus: data.launchStatus,
        name: data.name ?? '',
        adminUserEmail: data.adminUserEmail ?? '',
      },
      details: {
        state: details.state ?? '',
        city: details.city ?? '',
        county: details.county ?? '',
        zip: details.zip ?? '',
        district: details.district ?? '',
        office: details.office ?? '',
        otherOffice: details.otherOffice ?? '',
        ballotLevel: details.ballotLevel,
        level: details.level ?? null,
        officeTermLength: details.officeTermLength ?? '',
        electionDate: details.electionDate ?? '',
        primaryElectionDate: details.primaryElectionDate ?? '',
        partisanType: details.partisanType ?? '',
        filingPeriodsStart: details.filingPeriodsStart ?? '',
        filingPeriodsEnd: details.filingPeriodsEnd ?? '',
        party: details.party ?? '',
        otherParty: details.otherParty ?? '',
        occupation: details.occupation ?? '',
        funFact: details.funFact ?? '',
        pastExperience:
          typeof details.pastExperience === 'string'
            ? details.pastExperience
            : '',
        website: details.website ?? '',
        pledged: details.pledged ?? false,
      },
    },
  })

  useNavigationGuard({
    enabled: isDirty,
    confirm: () => window.confirm(UNSAVED_CHANGES_MESSAGE),
  })

  async function handleSubmit() {
    const formData = getValues()
    const result = combinedCampaignSchema.safeParse(formData)

    if (!result.success) {
      console.error('Validation errors:', result.error)
      return
    }

    try {
      await onSave(formData)
      reset(formData)
    } catch {
      // Save failed — keep the form dirty so the user can retry
    }
  }

  function getError(key: FieldPath) {
    if (key === 'details.website') return errors.details?.website
    return errors.data?.adminUserEmail
  }

  function renderFields(fields: FieldConfig[]) {
    return (
      <Flex gap="4" wrap="wrap">
        {fields.map(({ key, label, placeholder, type, hasError }) => {
          const error = hasError ? getError(key) : undefined
          return (
            <Box key={key} flexGrow="1" style={{ minWidth: '200px' }}>
              <Text as="label" size="2" weight="medium" mb="1">
                {label}
              </Text>
              <TextField.Root
                {...register(key)}
                type={type}
                placeholder={placeholder}
                color={error ? 'red' : undefined}
              />
              {error && <ErrorText>{error.message}</ErrorText>}
            </Box>
          )
        })}
      </Flex>
    )
  }

  function handleStatusFlagChange(key: StatusFlagKey, checked: boolean) {
    setValue(key, checked, { shouldDirty: true })
  }

  function handleTierChange(value: string) {
    if (isCampaignTier(value)) {
      setValue('tier', value, { shouldDirty: true })
    } else {
      setValue('tier', null, { shouldDirty: true })
    }
  }

  function handleLaunchStatusChange(value: string) {
    if (isLaunchStatus(value)) {
      setValue('data.launchStatus', value, { shouldDirty: true })
    } else {
      setValue('data.launchStatus', undefined, { shouldDirty: true })
    }
  }

  function handleBallotLevelChange(value: string) {
    if (isBallotLevel(value)) {
      setValue('details.ballotLevel', value, { shouldDirty: true })
    } else {
      setValue('details.ballotLevel', undefined, { shouldDirty: true })
    }
  }

  function handleElectionLevelChange(value: string) {
    if (isElectionLevel(value)) {
      setValue('details.level', value, { shouldDirty: true })
    } else {
      setValue('details.level', null, { shouldDirty: true })
    }
  }

  return (
    <>
      <Flex direction="column" gap="6">
        <InfoCard title={CAMPAIGN_FORM_SECTIONS.STATUS}>
          <Flex direction="column" gap="4">
            {STATUS_FLAGS.map(({ key, label }) => (
              <Flex key={key} justify="between" align="center">
                <Text as="label" size="2" htmlFor={key}>
                  {label}
                </Text>
                <Switch
                  id={key}
                  checked={!!watch(key)}
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
                {Object.values(CampaignTier).map((t) => (
                  <Select.Item key={t} value={t}>
                    {t}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>
        </InfoCard>

        <InfoCard title={CAMPAIGN_FORM_SECTIONS.DATA}>
          <Flex direction="column" gap="4">
            {renderFields([
              {
                key: 'data.name',
                label: 'Campaign Name',
                placeholder: 'Campaign name',
              },
              {
                key: 'data.adminUserEmail',
                label: 'Admin User Email',
                placeholder: 'admin@example.com',
                type: INPUT_TYPE.EMAIL,
                hasError: true,
              },
            ])}

            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium">
                Launch Status
              </Text>
              <Select.Root
                value={watch('data.launchStatus') ?? SELECT_NONE_VALUE}
                onValueChange={handleLaunchStatusChange}
              >
                <Select.Trigger placeholder="Select status..." />
                <Select.Content>
                  <Select.Item value={SELECT_NONE_VALUE}>None</Select.Item>
                  {Object.values(CampaignLaunchStatus).map((status) => (
                    <Select.Item key={status} value={status}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>
          </Flex>
        </InfoCard>

        <InfoCard title={CAMPAIGN_FORM_SECTIONS.LOCATION}>
          {renderFields(LOCATION_FIELDS)}
        </InfoCard>

        <InfoCard title={CAMPAIGN_FORM_SECTIONS.OFFICE}>
          <Flex direction="column" gap="4">
            {renderFields(OFFICE_TEXT_FIELDS)}

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
                  value={watch('details.ballotLevel') ?? SELECT_NONE_VALUE}
                  onValueChange={handleBallotLevelChange}
                >
                  <Select.Trigger placeholder="Select level..." />
                  <Select.Content>
                    <Select.Item value={SELECT_NONE_VALUE}>None</Select.Item>
                    {Object.values(BallotReadyPositionLevel).map((level) => (
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
                    {Object.values(ElectionLevel).map((level) => (
                      <Select.Item key={level} value={level}>
                        {level.charAt(0).toUpperCase() + level.slice(1)}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </Flex>
            </Flex>
          </Flex>
        </InfoCard>

        <InfoCard title={CAMPAIGN_FORM_SECTIONS.ELECTION}>
          {renderFields(ELECTION_FIELDS)}
        </InfoCard>

        <InfoCard title={CAMPAIGN_FORM_SECTIONS.FILING_PERIOD}>
          {renderFields(FILING_PERIOD_FIELDS)}
        </InfoCard>

        <InfoCard title={CAMPAIGN_FORM_SECTIONS.PARTY}>
          {renderFields(PARTY_FIELDS)}
        </InfoCard>

        <InfoCard title={CAMPAIGN_FORM_SECTIONS.BACKGROUND}>
          <Flex direction="column" gap="4">
            {renderFields(BACKGROUND_TEXT_FIELDS)}

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
                checked={!!watch('details.pledged')}
                onCheckedChange={(checked) =>
                  setValue('details.pledged', checked, { shouldDirty: true })
                }
              />
            </Flex>
          </Flex>
        </InfoCard>
      </Flex>

      <Separator size="4" my="6" />

      <FormActions
        onCancel={onCancel}
        onSubmit={handleSubmit}
        isValid={isValid}
        isDirty={isDirty}
        isSaving={isSaving}
      />
    </>
  )
}
