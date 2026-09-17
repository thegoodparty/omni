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
import { useEffect } from 'react'
import { useForm, type Path } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigationGuard } from 'next-navigation-guard'
import { InfoCard } from '../../components/InfoCard'
import { ErrorText } from '@/components/ErrorText'
import { FormActions } from './FormActions'
import { PositionNameEditor } from './PositionNameEditor'
import { DistrictPicker } from '@/shared/district/DistrictPicker'
import { updateCampaignDistrict } from '@/shared/district/district-actions'
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
import type {
  AdminOrganization,
  CampaignWithLiveContext,
} from '@goodparty_org/sdk'
import {
  FORM_MODE,
  INPUT_TYPE,
  CAMPAIGN_FORM_SECTIONS,
  SELECT_NONE_VALUE,
  UNSAVED_CHANGES_MESSAGE,
} from '../constants'
import {
  CAMPAIGN_FIELDS,
  buildEditFields,
  type EditFieldConfig,
} from '../../campaign-fields'

type FieldPath = Path<CombinedCampaignFormData>

type NestedRecord = Record<string, unknown>

/**
 * True when a field the admin actually edited is invalid.
 *
 * Campaign rows predate the current form schema, so a stored value can be
 * invalid through no action of the admin's — a website saved without a scheme,
 * an enum the catalog no longer lists. Gating Save on whole-form validity let
 * any such value block every unrelated edit, which is how a status-flag toggle
 * ended up unsaveable. Restricting the gate to dirty fields keeps the admin's
 * own bad input from being saved while leaving legacy data to be corrected
 * deliberately rather than as a toll on unrelated work.
 */
function hasErrorInEditedFields(
  errors: NestedRecord | undefined,
  dirtyFields: NestedRecord | undefined
): boolean {
  if (!errors || !dirtyFields) return false

  return Object.entries(dirtyFields).some(([key, dirty]) => {
    const error = errors[key]
    if (!error || !dirty) return false
    // A leaf is `true` when dirty; a group is an object mirroring the shape.
    if (dirty === true) return true
    return hasErrorInEditedFields(error as NestedRecord, dirty as NestedRecord)
  })
}

type StatusFlagKey =
  | 'isActive'
  | 'isVerified'
  | 'isPro'
  | 'isDemo'
  | 'canDownloadFederal'

const STATUS_FLAG_KEYS: readonly StatusFlagKey[] = [
  'isActive',
  'isVerified',
  'isPro',
  'isDemo',
  'canDownloadFederal',
] as const

// didWin is tri-state, not a flag: null means "no result yet" and is what
// keeps a campaign active/upgradeable (isActiveCampaign requires
// didWin === null). Rendering it as a Switch coerced null to false on every
// save, silently killing Pro eligibility for campaigns staff merely opened
// and saved (ENG-10892).
const DID_WIN_OPTIONS = [
  { value: SELECT_NONE_VALUE, label: 'No result yet' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
] as const

const didWinToOption = (didWin: boolean | null | undefined): string =>
  didWin === true ? 'won' : didWin === false ? 'lost' : SELECT_NONE_VALUE

const STATUS_FLAGS: { key: StatusFlagKey; label: string }[] =
  STATUS_FLAG_KEYS.map((key) => ({ key, label: CAMPAIGN_FIELDS[key].label }))

const DATA_FIELDS = buildEditFields<FieldPath>([
  'data.name',
  'data.adminUserEmail',
])

const LOCATION_FIELDS = buildEditFields<FieldPath>([
  'details.state',
  'details.city',
  'details.county',
  'details.zip',
])

const OFFICE_TEXT_FIELDS = buildEditFields<FieldPath>([
  'details.officeTermLength',
])

const ELECTION_FIELDS = buildEditFields<FieldPath>([
  'details.electionDate',
  'details.primaryElectionDate',
  'details.partisanType',
])

const FILING_PERIOD_FIELDS = buildEditFields<FieldPath>([
  'details.filingPeriodsStart',
  'details.filingPeriodsEnd',
])

const PARTY_FIELDS = buildEditFields<FieldPath>([
  'details.party',
  'details.otherParty',
])

const BACKGROUND_TEXT_FIELDS = buildEditFields<FieldPath>([
  'details.occupation',
  'details.website',
])

// Map our shared catalog's input kind to the form's InputType union
const INPUT_KIND_TO_TYPE: Record<
  NonNullable<EditFieldConfig['inputType']>,
  (typeof INPUT_TYPE)[keyof typeof INPUT_TYPE]
> = {
  text: INPUT_TYPE.TEXT,
  date: INPUT_TYPE.DATE,
  email: INPUT_TYPE.EMAIL,
}

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

function parseElectionYear(electionDate: string | null | undefined): number {
  if (!electionDate) return 0
  const year = Number(electionDate.split('-')[0])
  return Number.isFinite(year) ? year : 0
}

interface CampaignFormProps {
  initialData: CampaignWithLiveContext
  organization?: AdminOrganization | null
  initialDistrictType?: string
  initialDistrictName?: string
  onSave: (data: CombinedCampaignFormData) => void | Promise<void>
  onCancel: () => void
  isSaving?: boolean
}

export function CampaignForm({
  initialData,
  organization,
  initialDistrictType,
  initialDistrictName,
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
  const positionName = initialData.positionName ?? null

  const {
    register,
    watch,
    setValue,
    getValues,
    reset,
    trigger,
    formState: { errors, isDirty, dirtyFields },
  } = useForm<CombinedCampaignFormData>({
    mode: FORM_MODE.ON_CHANGE,
    resolver: zodResolver(combinedCampaignSchema),
    defaultValues: {
      isActive: isActive ?? false,
      isVerified: isVerified ?? false,
      isPro: isPro ?? false,
      isDemo: isDemo ?? false,
      didWin: didWin ?? null,
      tier,
      canDownloadFederal: canDownloadFederal ?? false,
      data: {
        // The schema's enums accept `undefined` but not `null`, and these live
        // in a JSON blob where legacy rows store null. Without the coalesce the
        // form mounts invalid, which permanently disables Save.
        launchStatus: data.launchStatus ?? undefined,
        name: data.name ?? '',
        adminUserEmail: data.adminUserEmail ?? '',
      },
      details: {
        state: details.state ?? '',
        city: details.city ?? '',
        county: details.county ?? '',
        zip: details.zip ?? '',
        ballotLevel: details.ballotLevel ?? undefined,
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

  // Save is gated on `isValid`, and react-hook-form's mount-time validation
  // sets that flag without populating `errors`. A campaign whose stored data
  // fails the schema therefore renders a permanently disabled Save button with
  // nothing on screen explaining why. Validating up front surfaces the field.
  useEffect(() => {
    void trigger()
  }, [trigger])

  useNavigationGuard({
    enabled: isDirty,
    confirm: () => window.confirm(UNSAVED_CHANGES_MESSAGE),
  })

  const hasBlockingError = hasErrorInEditedFields(
    errors as NestedRecord,
    dirtyFields as NestedRecord
  )

  async function handleSubmit() {
    const formData = getValues()

    if (hasBlockingError) {
      console.error('Validation errors:', errors)
      return
    }

    const result = combinedCampaignSchema.safeParse(formData)
    if (!result.success) {
      // Untouched stored fields are out of the admin's control, so they are
      // logged and sent back as-is rather than blocking the edit at hand.
      console.warn('Saving campaign with pre-existing invalid fields:', {
        campaignId: initialData.id,
        issues: result.error.issues,
      })
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
    if (key === 'data.adminUserEmail') return errors.data?.adminUserEmail
    return undefined
  }

  function renderFields(fields: EditFieldConfig<FieldPath>[]) {
    return (
      <Flex gap="4" wrap="wrap">
        {fields.map(({ key, label, placeholder, inputType, hasError }) => {
          const error = hasError ? getError(key) : undefined
          const type = inputType ? INPUT_KIND_TO_TYPE[inputType] : undefined
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
    setValue(key, checked, { shouldDirty: true, shouldValidate: true })
  }

  function handleDidWinChange(value: string) {
    setValue(
      'didWin',
      value === 'won' ? true : value === 'lost' ? false : null,
      {
        shouldDirty: true,
        shouldValidate: true,
      }
    )
  }

  function handleTierChange(value: string) {
    if (isCampaignTier(value)) {
      setValue('tier', value, { shouldDirty: true, shouldValidate: true })
    } else {
      setValue('tier', null, { shouldDirty: true, shouldValidate: true })
    }
  }

  function handleLaunchStatusChange(value: string) {
    if (isLaunchStatus(value)) {
      setValue('data.launchStatus', value, {
        shouldDirty: true,
        shouldValidate: true,
      })
    } else {
      setValue('data.launchStatus', undefined, {
        shouldDirty: true,
        shouldValidate: true,
      })
    }
  }

  function handleBallotLevelChange(value: string) {
    if (isBallotLevel(value)) {
      setValue('details.ballotLevel', value, {
        shouldDirty: true,
        shouldValidate: true,
      })
    } else {
      setValue('details.ballotLevel', undefined, {
        shouldDirty: true,
        shouldValidate: true,
      })
    }
  }

  function handleElectionLevelChange(value: string) {
    if (isElectionLevel(value)) {
      setValue('details.level', value, {
        shouldDirty: true,
        shouldValidate: true,
      })
    } else {
      setValue('details.level', null, {
        shouldDirty: true,
        shouldValidate: true,
      })
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
                  checked={watch(key) ?? false}
                  onCheckedChange={(checked) =>
                    handleStatusFlagChange(key, checked)
                  }
                />
              </Flex>
            ))}
            <Flex justify="between" align="center">
              <Text as="label" size="2">
                {CAMPAIGN_FIELDS.didWin.label}
              </Text>
              <Select.Root
                value={didWinToOption(watch('didWin'))}
                onValueChange={handleDidWinChange}
              >
                <Select.Trigger aria-label={CAMPAIGN_FIELDS.didWin.label} />
                <Select.Content>
                  {DID_WIN_OPTIONS.map(({ value, label }) => (
                    <Select.Item key={value} value={value}>
                      {label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>
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
              <Select.Trigger aria-label="Tier" placeholder="Select tier..." />
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
            {renderFields(DATA_FIELDS)}

            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium">
                Launch Status
              </Text>
              <Select.Root
                value={watch('data.launchStatus') ?? SELECT_NONE_VALUE}
                onValueChange={handleLaunchStatusChange}
              >
                <Select.Trigger
                  aria-label="Launch Status"
                  placeholder="Select status..."
                />
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

        <DistrictPicker
          state={watch('details.state') ?? ''}
          electionYear={parseElectionYear(watch('details.electionDate'))}
          initialL2DistrictType={initialDistrictType}
          initialL2DistrictName={initialDistrictName}
          onSave={async ({ L2DistrictType, L2DistrictName }) => {
            await updateCampaignDistrict(
              initialData.id,
              L2DistrictType,
              L2DistrictName,
              initialData.userId
            )
          }}
        />

        <InfoCard title={CAMPAIGN_FORM_SECTIONS.OFFICE}>
          <Flex direction="column" gap="4">
            {organization ? (
              <PositionNameEditor
                organizationSlug={organization.slug}
                campaignId={initialData.id}
                userId={initialData.userId}
                initialCustomPositionName={
                  organization.customPositionName ?? null
                }
                structuredPositionName={organization.position?.name ?? null}
              />
            ) : (
              <Box>
                <Text as="label" size="2" weight="medium" mb="1">
                  Position
                </Text>
                <TextField.Root value={positionName ?? ''} readOnly disabled />
                <Text as="p" size="1" color="gray" mt="1">
                  This campaign has no organization record, so its position
                  cannot be edited here.
                </Text>
              </Box>
            )}

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
                  <Select.Trigger
                    aria-label="Ballot Level"
                    placeholder="Select level..."
                  />
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
                  <Select.Trigger
                    aria-label="Election Level"
                    placeholder="Select level..."
                  />
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
                checked={watch('details.pledged') ?? false}
                onCheckedChange={(checked) =>
                  setValue('details.pledged', checked, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
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
        isValid={!hasBlockingError}
        isDirty={isDirty}
        isSaving={isSaving}
      />
    </>
  )
}
