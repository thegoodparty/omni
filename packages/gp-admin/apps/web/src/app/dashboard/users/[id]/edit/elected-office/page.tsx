'use client'

import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { stubbedElectedOffice } from '@/data/stubbed-elected-office'
import { stubbedCampaign } from '@/data/stubbed-campaign'
import { ElectedOfficeForm } from '../components/ElectedOfficeForm'
import type { ElectedOfficeFormData } from '../schema'

export default function EditElectedOfficePage() {
  const router = useRouter()
  const { showToast } = useToast()

  const hasElectedOffice = stubbedCampaign.didWin === true
  const electedOffice = hasElectedOffice ? stubbedElectedOffice : null

  function handleSave(data: ElectedOfficeFormData) {
    console.log('[PATCH /elected-offices/:id] Saving:', data)
    showToast('Changes saved (simulated)')
  }

  function handleCancel() {
    router.push(`/dashboard/users/${stubbedCampaign.userId}/elected-office`)
  }

  return (
    <ElectedOfficeForm
      initialData={electedOffice}
      onSave={handleSave}
      onCancel={handleCancel}
    />
  )
}
