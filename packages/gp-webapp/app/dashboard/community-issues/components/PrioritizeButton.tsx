'use client'

import { useState } from 'react'
import { Button } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

interface Props {
  issueId: string
  onPrioritized: () => void
}

const PrioritizeButton = ({
  issueId,
  onPrioritized,
}: Props): React.JSX.Element => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClick = async () => {
    trackEvent(EVENTS.CommunityIssues.PrioritizeClicked, { issueId })
    setLoading(true)
    setError(null)
    try {
      await clientRequest('POST /v1/community-issues/:id/prioritize', {
        id: issueId,
      })
      onPrioritized()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleClick} disabled={loading}>
        Add to my priorities
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

export default PrioritizeButton
