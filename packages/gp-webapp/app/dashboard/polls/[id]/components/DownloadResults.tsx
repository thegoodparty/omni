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
        // read the blob. Doing either in the same tick as click() cancels the
        // download in Chrome and surfaces as a spurious "check your connection"
        // / network error. Keep the button disabled across this window too, so a
        // second click can't stack a parallel download and leak its object URL.
        setTimeout(() => {
          link.remove()
          window.URL.revokeObjectURL(url)
          setLoading(false)
        }, 1500)
      } else {
        console.error('Failed to download poll responses', res)
        errorSnackbar("Couldn't download results. Please try again.")
        setLoading(false)
      }
    } catch (e) {
      reportErrorToSentry(e, { context: 'DownloadResults.handleDownload' })
      errorSnackbar("Couldn't download results. Please try again.")
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
