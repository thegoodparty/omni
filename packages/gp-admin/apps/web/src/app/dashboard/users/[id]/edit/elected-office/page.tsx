'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { SuccessCallout } from '@/components/SuccessCallout'
import { stubbedElectedOffice } from '@/data/stubbed-elected-office'
import { stubbedCampaign } from '@/data/stubbed-campaign'
import { ElectedOfficeForm } from '../components/ElectedOfficeForm'
import type { ElectedOfficeFormData } from '../schema'

export default function EditElectedOfficePage() {
  const router = useRouter()
  const [saveSuccess, setSaveSuccess] = useState(false)

  const hasElectedOffice = stubbedCampaign.didWin === true
  const electedOffice = hasElectedOffice ? stubbedElectedOffice : null

  function handleSave(data: ElectedOfficeFormData) {
    console.log('[PATCH /elected-offices/:id] Saving:', data)

    setSaveSuccess(true)
    setTimeout(() => {
      setSaveSuccess(false)
    }, 2000)
  }

  function handleCancel() {
    router.push(`/dashboard/users/${stubbedCampaign.userId}/elected-office`)
  }

  return (
    <>
      <SuccessCallout
        visible={saveSuccess}
        message="Changes saved (simulated)"
      />

      <ElectedOfficeForm
        initialData={electedOffice}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    </>
  )
}
