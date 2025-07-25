'use client'

import { useState, useEffect } from 'react'
import { notFound } from 'next/navigation'
import WebsitePage from '../components/WebsitePage'
import { Website } from '../types/website.type'

interface PreviewPageClientProps {
  vanityPath: string
}

export default function PreviewPageClient({ vanityPath }: PreviewPageClientProps) {
  const [website, setWebsite] = useState<Website | null>(null)
  const [hasReceivedData, setHasReceivedData] = useState(false)

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'WEBSITE_DATA') {
        setWebsite(event.data.data)
        setHasReceivedData(true)
      }
    }

    window.addEventListener('message', handleMessage)

    const timeout = setTimeout(() => {
      if (!hasReceivedData) {
        setHasReceivedData(true)
      }
    }, 3000)

    return () => {
      window.removeEventListener('message', handleMessage)
      clearTimeout(timeout)
    }
  }, [hasReceivedData])

  if (!hasReceivedData) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Loading preview...</div>
      </div>
    )
  }

  if (!website) {
    notFound()
  }

  return <WebsitePage website={website} isPreview />
} 