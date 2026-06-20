'use client'

import { useState } from 'react'
import { Button } from '@styleguide'
import { StarIcon, CheckIcon } from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

interface Props {
  issueId: string
  initialPrioritized: boolean
}

const PrioritizeButton = ({
  issueId,
  initialPrioritized,
}: Props): React.JSX.Element => {
  const [prioritized, setPrioritized] = useState(initialPrioritized)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (prioritized) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-success-dark">
        <CheckIcon className="size-4" aria-hidden />
        Added to priorities
      </span>
    )
  }

  const handleClick = async () => {
    trackEvent(EVENTS.CommunityIssues.PrioritizeClicked, { issueId })
    setLoading(true)
    setError(null)
    try {
      await clientRequest('POST /v1/community-issues/:id/prioritize', {
        id: issueId,
      })
      setPrioritized(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        onClick={handleClick}
        disabled={loading}
        className="flex items-center gap-1.5"
      >
        <StarIcon className="size-4" aria-hidden />
        Add to my priorities
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

export default PrioritizeButton
