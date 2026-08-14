'use client'

import { Button } from '@styleguide'
import { API_VERSION_PREFIX } from 'appEnv'
import { usePoll } from '../../shared/hooks/PollProvider'

export default function DownloadResults() {
  const [poll] = usePoll()

  const handleDownload = () => {
    // Navigate straight to the endpoint and let Content-Disposition save the
    // file. middleware.ts proxies /api/v1/* to gp-api and injects the auth +
    // org headers, so a plain same-origin link downloads the CSV. This avoids
    // the fetch -> blob -> object-URL path, whose blob-download step failed
    // intermittently in Chrome with a spurious "check your connection" error.
    const link = document.createElement('a')
    link.href = `/api${API_VERSION_PREFIX}/polls/${poll.id}/download-responses`
    link.setAttribute('download', `${poll.name}-responses.csv`)
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  return (
    <Button className="w-full md:w-auto" onClick={handleDownload}>
      Download results
    </Button>
  )
}
