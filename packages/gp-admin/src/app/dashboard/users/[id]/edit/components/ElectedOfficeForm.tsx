'use client'

import {
  TextField,
  Text,
  Box,
  Flex,
  Callout,
  Separator,
} from '@radix-ui/themes'
import { HiInformationCircle } from 'react-icons/hi'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigationGuard } from 'next-navigation-guard'
import { electedOfficeSchema, type ElectedOfficeFormData } from '../schema'
import { InfoCard } from '../../components/InfoCard'
import { FormActions } from './FormActions'
import { DistrictPicker } from '@/shared/district/DistrictPicker'
import { updateElectedOfficeDistrict } from '@/shared/district/district-actions'
import {
  INPUT_TYPE,
  ELECTED_OFFICE_FORM_SECTIONS,
  FORM_MODE,
  UNSAVED_CHANGES_MESSAGE,
} from '../constants'
import type { ElectedOffice } from '@goodparty_org/sdk'

interface ElectedOfficeFormProps {
  initialData: ElectedOffice | null
  userId?: number
  state?: string
  electionYear?: number
  initialDistrictType?: string
  initialDistrictName?: string
  onSave: (data: ElectedOfficeFormData) => void | Promise<void>
  onCancel: () => void
  isSaving?: boolean
}

export function ElectedOfficeForm({
  initialData,
  userId,
  state,
  electionYear,
  initialDistrictType,
  initialDistrictName,
  onSave,
  onCancel,
  isSaving,
}: ElectedOfficeFormProps) {
  const hasElectedOffice = initialData !== null

  const {
    register,
    getValues,
    reset,
    formState: { isDirty, isValid },
  } = useForm<ElectedOfficeFormData>({
    mode: FORM_MODE.ON_CHANGE,
    resolver: zodResolver(electedOfficeSchema),
    defaultValues: {
      electedDate: initialData?.electedDate ?? null,
      swornInDate: initialData?.swornInDate ?? null,
      termStartDate: initialData?.termStartDate ?? null,
      termEndDate: initialData?.termEndDate ?? null,
      party: initialData?.party ?? null,
    },
  })

  useNavigationGuard({
    enabled: isDirty,
    confirm: () => window.confirm(UNSAVED_CHANGES_MESSAGE),
  })

  async function handleSubmit() {
    const data = getValues()
    const result = electedOfficeSchema.safeParse(data)

    if (!result.success) {
      console.error('Validation errors:', result.error)
      return
    }

    try {
      await onSave(result.data)
      reset(result.data)
    } catch {
      // Save failed — keep the form dirty so the user can retry
    }
  }

  if (!hasElectedOffice) {
    return (
      <Callout.Root color="gray">
        <Callout.Icon>
          <HiInformationCircle />
        </Callout.Icon>
        <Callout.Text>
          No elected office record exists for this campaign. An elected office
          record is created when a candidate wins their election.
        </Callout.Text>
      </Callout.Root>
    )
  }

  return (
    <>
      <Flex direction="column" gap="4">
        <InfoCard title={ELECTED_OFFICE_FORM_SECTIONS.TERM_INFO}>
          <Flex direction="column" gap="4">
            <Flex gap="4" wrap="wrap">
              <Box flexGrow="1" style={{ minWidth: '200px' }}>
                <Text as="label" size="2" weight="medium" mb="1">
                  Elected Date
                </Text>
                <TextField.Root
                  {...register('electedDate')}
                  type={INPUT_TYPE.DATE}
                />
              </Box>
              <Box flexGrow="1" style={{ minWidth: '200px' }}>
                <Text as="label" size="2" weight="medium" mb="1">
                  Sworn In Date
                </Text>
                <TextField.Root
                  {...register('swornInDate')}
                  type={INPUT_TYPE.DATE}
                />
              </Box>
            </Flex>

            <Flex gap="4" wrap="wrap">
              <Box flexGrow="1" style={{ minWidth: '200px' }}>
                <Text as="label" size="2" weight="medium" mb="1">
                  Term Start Date
                </Text>
                <TextField.Root
                  {...register('termStartDate')}
                  type={INPUT_TYPE.DATE}
                />
              </Box>
              <Box flexGrow="1" style={{ minWidth: '200px' }}>
                <Text as="label" size="2" weight="medium" mb="1">
                  Term End Date
                </Text>
                <TextField.Root
                  {...register('termEndDate')}
                  type={INPUT_TYPE.DATE}
                />
              </Box>
            </Flex>

            <Flex gap="4" wrap="wrap">
              <Box style={{ maxWidth: '200px' }} flexGrow="1">
                <Text as="label" size="2" weight="medium" mb="1">
                  Party
                </Text>
                <TextField.Root
                  {...register('party')}
                  placeholder="e.g., Independent"
                />
              </Box>
            </Flex>
          </Flex>
        </InfoCard>

        {initialData && userId !== undefined && (
          <DistrictPicker
            state={state ?? ''}
            electionYear={electionYear ?? 0}
            initialL2DistrictType={initialDistrictType}
            initialL2DistrictName={initialDistrictName}
            // Serve represents today's constituents, so a proposed district is
            // definitionally wrong here. Those rows carry no projected turnout,
            // so excluding on that keeps them out of this picker — which
            // defaultExcludeInvalid={false} was letting through.
            defaultExcludeInvalid={true}
            onSave={async ({ L2DistrictType, L2DistrictName }) => {
              await updateElectedOfficeDistrict(
                initialData.id,
                state ?? '',
                L2DistrictType,
                L2DistrictName,
                userId
              )
            }}
          />
        )}
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
