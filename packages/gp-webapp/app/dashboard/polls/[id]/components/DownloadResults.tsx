'use client'

import { useState } from 'react'
import { Button } from '@styleguide'
import { clientFetch } from 'gpApi/clientFetch'
import { apiRoutes } from 'gpApi/routes'
import { useSnackbar } from 'helpers/useSnackbar'
import { reportErrorToSentry } from '@shared/sentry'
import { usePoll } from '../../shared/hooks/PollProvider'

export default function DownloadResults() {
  const [poll] = usePoll()
  const [loading, setLoading] = useState(false)
  const { errorSnackbar } = useSnackbar()

  const handleDownload = async () => {
    setLoading(true)
    try {
      const res = await clientFetch(
        apiRoutes.polls.downloadResponses,
        { pollId: poll.id },
        { returnFullResponse: true },
      )

      if (res.ok) {
        const blob = await res.blob()
        const url = window.URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', `${poll.name}-responses.csv`)
        document.body.appendChild(link)
        link.click()
        // Detach the anchor and free the object URL only after the browser has
        // had time to read the blob. Doing either synchronously after click()
        // cancels the download in Chrome and surfaces as a spurious "check your
        // connection" / network error.
        setTimeout(() => {
          link.remove()
          window.URL.revokeObjectURL(url)
        }, 10000)
      } else {
        console.error('Failed to download poll responses', res)
        errorSnackbar("Couldn't download results. Please try again.")
      }
    } catch (e) {
      reportErrorToSentry(e, { context: 'DownloadResults.handleDownload' })
      errorSnackbar("Couldn't download results. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      className="w-full md:w-auto"
      onClick={handleDownload}
      disabled={loading}
    >
      {loading ? 'Downloading...' : 'Download results'}
    </Button>
  )
}
