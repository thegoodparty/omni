import { Button, DownloadIcon } from '@styleguide'
import { API_VERSION_PREFIX } from 'appEnv'
import { whatWeHeardCopy } from '../../copy'

// A plain same-origin link, not a fetch: middleware.ts proxies /api/v1/* to
// gp-api with the session cookie attached, so the browser's own download
// attribute saves the file gp-api streams back (DownloadResults.tsx's
// pattern for the polls CSV). No client-side CSV building.
const DownloadNotesLink = ({
  outreachId,
  hasNotes,
  isServe,
}: {
  outreachId: number
  hasNotes: boolean
  isServe: boolean
}) => {
  if (!hasNotes) return null

  return (
    <Button asChild variant="outline" size="small">
      <a
        href={`/api${API_VERSION_PREFIX}/constituent-feedback/efforts/${outreachId}/export`}
        download
      >
        <DownloadIcon aria-hidden="true" />
        {whatWeHeardCopy(isServe).downloadNotes}
      </a>
    </Button>
  )
}

export default DownloadNotesLink
