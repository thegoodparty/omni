'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { SuccessCallout } from '@/components/SuccessCallout'
import { stubbedCampaign } from '@/data/stubbed-campaign'
import {
  CampaignEditForm,
  type CombinedCampaignFormData,
} from '../components/CampaignEditForm'

export default function EditCampaignPage() {
  const router = useRouter()
  const [saveSuccess, setSaveSuccess] = useState(false)

  function handleSave(data: CombinedCampaignFormData) {
    console.log('[PATCH /campaigns/:id] Saving:', data)

    setSaveSuccess(true)
    setTimeout(() => {
      setSaveSuccess(false)
    }, 2000)
  }

  function handleCancel() {
    router.push(`/dashboard/users/${stubbedCampaign.userId}/campaign`)
  }

  return (
    <>
      <SuccessCallout
        visible={saveSuccess}
        message="Changes saved (simulated)"
      />

      <CampaignEditForm
        initialData={stubbedCampaign}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    </>
  )
}
