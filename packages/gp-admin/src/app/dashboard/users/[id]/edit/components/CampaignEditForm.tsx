'use client'

import { Flex, Separator } from '@radix-ui/themes'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigationGuard } from 'next-navigation-guard'
import { FormActions } from './FormActions'
import { CampaignStatusFields } from './CampaignStatusFields'
import { CampaignDetailsFields } from './CampaignDetailsFields'
import {
  combinedCampaignSchema,
  type CombinedCampaignFormData,
} from '../schema'
import type { Campaign } from '@goodparty_org/sdk'
import { FORM_MODE, UNSAVED_CHANGES_MESSAGE } from '../constants'

interface CampaignEditFormProps {
  initialData: Campaign
  onSave: (data: CombinedCampaignFormData) => void | Promise<void>
  onCancel: () => void
  isSaving?: boolean
}

export function CampaignEditForm({
  initialData,
  onSave,
  onCancel,
  isSaving,
}: CampaignEditFormProps) {
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
        adminUserEmail: '',
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

  const fieldProps = { register, watch, setValue, errors }

  return (
    <>
      <Flex direction="column" gap="6">
        <CampaignStatusFields {...fieldProps} />
        <CampaignDetailsFields {...fieldProps} />
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
