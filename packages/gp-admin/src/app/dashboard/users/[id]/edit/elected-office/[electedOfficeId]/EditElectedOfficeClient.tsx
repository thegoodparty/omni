'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { updateElectedOffice } from '@/app/dashboard/elected-offices/actions'
import { ElectedOfficeForm } from '../../components/ElectedOfficeForm'
import type { ElectedOfficeFormData } from '../../schema'
import type { ElectedOffice } from '@goodparty_org/sdk'

interface EditElectedOfficeClientProps {
  electedOffice: ElectedOffice
  userId: number
}

export function EditElectedOfficeClient({
  electedOffice,
  userId,
}: EditElectedOfficeClientProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [isSaving, setIsSaving] = useState(false)

  async function handleSave(formData: ElectedOfficeFormData) {
    setIsSaving(true)
    try {
      await updateElectedOffice(electedOffice.id, userId, formData)
      showToast('Elected office saved')
      router.push(`/dashboard/users/${userId}/elected-office`)
    } catch (error) {
      console.error('Failed to save elected office:', error)
      showToast('Failed to save elected office')
      throw error
    } finally {
      setIsSaving(false)
    }
  }

  function handleCancel() {
    router.push(`/dashboard/users/${userId}/elected-office`)
  }

  return (
    <ElectedOfficeForm
      initialData={electedOffice}
      onSave={handleSave}
      onCancel={handleCancel}
      isSaving={isSaving}
    />
  )
}
