'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { updateCampaign } from '@/app/dashboard/campaigns/actions'
import { CampaignForm } from '../../components/CampaignForm'
import type { CombinedCampaignFormData } from '../../schema'
import type {
  AdminOrganization,
  CampaignWithLiveContext,
} from '@goodparty_org/sdk'

interface EditCampaignClientProps {
  campaign: CampaignWithLiveContext
  organization?: AdminOrganization | null
  initialDistrictType?: string
  initialDistrictName?: string
}

export function EditCampaignClient({
  campaign,
  organization,
  initialDistrictType,
  initialDistrictName,
}: EditCampaignClientProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [isSaving, setIsSaving] = useState(false)

  async function handleSave(formData: CombinedCampaignFormData) {
    const { details, ...rest } = formData

    setIsSaving(true)
    try {
      await updateCampaign(campaign.id, campaign.userId, { ...rest, details })
      showToast('Campaign saved')
      router.push(`/dashboard/users/${campaign.userId}/campaign`)
    } catch (error) {
      console.error('Failed to save campaign:', error)
      showToast('Failed to save campaign')
      throw error
    } finally {
      setIsSaving(false)
    }
  }

  function handleCancel() {
    router.push(`/dashboard/users/${campaign.userId}/campaign`)
  }

  return (
    <CampaignForm
      initialData={campaign}
      organization={organization}
      initialDistrictType={initialDistrictType}
      initialDistrictName={initialDistrictName}
      onSave={handleSave}
      onCancel={handleCancel}
      isSaving={isSaving}
    />
  )
}
