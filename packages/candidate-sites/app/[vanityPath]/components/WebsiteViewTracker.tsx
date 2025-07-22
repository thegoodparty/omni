'use client'
import { trackWebsiteView } from '@/app/shared/utils/websiteTracking'
import { useEffect } from 'react'

export default function WebsiteViewTracker({ vanityPath }: { vanityPath: string }) {
  useEffect(() => {
    if (vanityPath) {
      trackWebsiteView(vanityPath)
    }
  }, [vanityPath])

  return null
}
