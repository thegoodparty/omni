'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { SuccessCallout } from '@/components/SuccessCallout'
import { stubbedPathToVictory } from '@/data/stubbed-p2v'
import { stubbedCampaign } from '@/data/stubbed-campaign'
import { P2VForm } from '../components/P2VForm'
import type { PathToVictoryFormData } from '../schema'

export default function EditP2VPage() {
  const router = useRouter()
  const [saveSuccess, setSaveSuccess] = useState(false)

  function handleSave(data: PathToVictoryFormData) {
    console.log('[PATCH /path-to-victory/:id] Saving:', data)

    setSaveSuccess(true)
    setTimeout(() => {
      setSaveSuccess(false)
    }, 2000)
  }

  function handleCancel() {
    router.push(`/dashboard/users/${stubbedCampaign.userId}/p2v`)
  }

  return (
    <>
      <SuccessCallout
        visible={saveSuccess}
        message="Changes saved (simulated)"
      />

      <P2VForm
        initialData={stubbedPathToVictory}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    </>
  )
}
