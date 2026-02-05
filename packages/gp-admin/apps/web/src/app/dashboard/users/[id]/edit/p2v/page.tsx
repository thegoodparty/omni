'use client'

import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { stubbedPathToVictory } from '@/data/stubbed-p2v'
import { stubbedCampaign } from '@/data/stubbed-campaign'
import { P2VForm } from '../components/P2VForm'
import type { PathToVictoryFormData } from '../schema'

export default function EditP2VPage() {
  const router = useRouter()
  const { showToast } = useToast()

  function handleSave(data: PathToVictoryFormData) {
    console.log('[PATCH /path-to-victory/:id] Saving:', data)
    showToast('Changes saved (simulated)')
  }

  function handleCancel() {
    router.push(`/dashboard/users/${stubbedCampaign.userId}/p2v`)
  }

  return (
    <P2VForm
      initialData={stubbedPathToVictory}
      onSave={handleSave}
      onCancel={handleCancel}
    />
  )
}
