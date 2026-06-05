'use client'

import { useState } from 'react'
import { Button } from '@radix-ui/themes'
import { HiOutlineEye } from 'react-icons/hi'
import { useToast } from '@/components/Toast'
import { startBriefingReview } from '../actions'

interface ReviewBriefingButtonProps {
  briefingId: string
}

export function ReviewBriefingButton({
  briefingId,
}: ReviewBriefingButtonProps) {
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)

  async function handleReview() {
    setLoading(true)
    try {
      const { url } = await startBriefingReview(briefingId)
      window.open(url, 'gp-review-tab')
      setLoading(false)
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to start review'
      )
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" onClick={handleReview} disabled={loading}>
      <HiOutlineEye className="w-4 h-4" />
      {loading ? 'Opening...' : 'Review'}
    </Button>
  )
}
