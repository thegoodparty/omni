'use client'

import { useRouter } from 'next/navigation'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Flex, Button, Separator } from '@radix-ui/themes'
import { HiCheck, HiX } from 'react-icons/hi'
import { SuccessCallout } from '@/components/SuccessCallout'
import { useState } from 'react'
import { stubbedCampaign } from '@/data/stubbed-campaign'
import {
  campaignSchema,
  campaignDetailsSchema,
  type CampaignFormData,
  type CampaignDetailsFormData,
} from '../schema'
import { CampaignForm } from '../components/CampaignForm'
import { CampaignDetailsForm } from '../components/CampaignDetailsForm'
import { useUnsavedChangesWarning } from '../../hooks/useUnsavedChangesWarning'
import { FORM_MODE } from '../constants'

export default function EditCampaignPage() {
  const router = useRouter()
  const [saveSuccess, setSaveSuccess] = useState(false)

  const campaignForm = useForm<CampaignFormData>({
    mode: FORM_MODE.ON_CHANGE,
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      isActive: stubbedCampaign.isActive,
      isVerified: stubbedCampaign.isVerified ?? false,
      isPro: stubbedCampaign.isPro ?? false,
      isDemo: stubbedCampaign.isDemo,
      didWin: stubbedCampaign.didWin ?? false,
      tier: null,
      canDownloadFederal: stubbedCampaign.canDownloadFederal,
      data: {
        launchStatus: stubbedCampaign.data.launchStatus,
        name: stubbedCampaign.data.name ?? '',
        adminUserEmail: '',
      },
    },
  })

  const detailsForm = useForm<CampaignDetailsFormData>({
    mode: FORM_MODE.ON_CHANGE,
    resolver: zodResolver(campaignDetailsSchema),
    defaultValues: {
      state: stubbedCampaign.details.state ?? '',
      city: stubbedCampaign.details.city ?? '',
      county: stubbedCampaign.details.county ?? '',
      zip: stubbedCampaign.details.zip ?? '',
      district: '',
      office: stubbedCampaign.details.office ?? '',
      otherOffice: stubbedCampaign.details.otherOffice ?? '',
      ballotLevel: stubbedCampaign.details.ballotLevel,
      level: stubbedCampaign.details.level ?? null,
      officeTermLength: stubbedCampaign.details.officeTermLength ?? '',
      electionDate: stubbedCampaign.details.electionDate ?? '',
      primaryElectionDate: '',
      partisanType: stubbedCampaign.details.partisanType ?? '',
      filingPeriodsStart: stubbedCampaign.details.filingPeriodsStart ?? '',
      filingPeriodsEnd: stubbedCampaign.details.filingPeriodsEnd ?? '',
      party: stubbedCampaign.details.party ?? '',
      otherParty: stubbedCampaign.details.otherParty ?? '',
      occupation: stubbedCampaign.details.occupation ?? '',
      funFact: stubbedCampaign.details.funFact ?? '',
      pastExperience:
        typeof stubbedCampaign.details.pastExperience === 'string'
          ? stubbedCampaign.details.pastExperience
          : '',
      website: stubbedCampaign.details.website ?? '',
      pledged: stubbedCampaign.details.pledged ?? false,
    },
  })

  const isDirty =
    campaignForm.formState.isDirty || detailsForm.formState.isDirty
  const isValid =
    campaignForm.formState.isValid && detailsForm.formState.isValid

  useUnsavedChangesWarning(isDirty)

  function handleCancel() {
    router.push(`/dashboard/users/${stubbedCampaign.userId}/campaign`)
  }

  function handleSave() {
    const campaignData = campaignForm.getValues()
    const detailsData = detailsForm.getValues()

    const campaignResult = campaignSchema.safeParse(campaignData)
    const detailsResult = campaignDetailsSchema.safeParse(detailsData)

    if (!campaignResult.success) {
      console.error('Campaign validation errors:', campaignResult.error)
      return
    }
    if (!detailsResult.success) {
      console.error('Details validation errors:', detailsResult.error)
      return
    }

    console.log('[PATCH /campaigns/:id] Saving:', {
      ...campaignData,
      details: detailsData,
    })

    setSaveSuccess(true)
    setTimeout(() => {
      setSaveSuccess(false)
    }, 2000)
  }

  return (
    <>
      <SuccessCallout
        visible={saveSuccess}
        message="Changes saved (simulated)"
      />

      <Flex direction="column" gap="6">
        <FormProvider {...campaignForm}>
          <CampaignForm />
        </FormProvider>
        <FormProvider {...detailsForm}>
          <CampaignDetailsForm />
        </FormProvider>
      </Flex>

      <Separator size="4" my="6" />

      <Flex gap="3" justify="end">
        <Button
          type="button"
          variant="soft"
          color="gray"
          onClick={handleCancel}
        >
          <HiX className="w-4 h-4" />
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          disabled={!isValid || !isDirty}
        >
          <HiCheck className="w-4 h-4" />
          Save Changes
        </Button>
      </Flex>
    </>
  )
}
