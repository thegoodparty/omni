'use client'

import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { stubbedCampaign } from '@/data/stubbed-campaign'
import {
  CampaignEditForm,
  type CombinedCampaignFormData,
} from '../components/CampaignEditForm'

export default function EditCampaignPage() {
  const router = useRouter()
  const { showToast } = useToast()

  function handleSave(data: CombinedCampaignFormData) {
    console.log('[PATCH /campaigns/:id] Saving:', data)
    showToast('Changes saved (simulated)')
  }

  function handleCancel() {
    router.push(`/dashboard/users/${stubbedCampaign.userId}/campaign`)
  }

  return (
    <CampaignEditForm
      initialData={stubbedCampaign}
      onSave={handleSave}
      onCancel={handleCancel}
    />
  )
}
