'use client'

import { useEffect, useState } from 'react'
import { useCampaign } from '@shared/hooks/useCampaign'
import type { BallotStatus } from 'helpers/types'
import ManagerPromptCard from './ManagerPromptCard'

// Persisted skip, matching the meet and personalize cards. Keyed per browser,
// not per campaign: the ⋮ "Skip" is a nudge dismissal, not a record that the
// candidate filed.
const BALLOT_DISMISSED_KEY = 'campaign-manager-ballot-dismissed'

// The two "not on the ballot yet" onboarding answers, each with the copy that
// matches where they actually are: one has decided and needs to file, the other
// is still weighing it and asked what it takes.
const BALLOT_CARD_COPY = {
  'qualified-not-filed': {
    title: "Great. Let's get you on the ballot",
    description:
      'You told us you meet the requirements but have not filed yet. I can ' +
      'walk you through exactly what your elections office needs and when.',
    ctaLabel: 'Show me how to file',
  },
  considering: {
    title: "Let's see what it takes to get on the ballot",
    description:
      'You told us you are considering a run. I can lay out the ' +
      'requirements, the deadline, and the real effort involved so you can ' +
      'decide.',
    ctaLabel: 'Show me what it takes',
  },
} as const

interface Props {
  onGetOnBallot: () => void
}

// Shown to the candidate who told us in onboarding they are not on the ballot
// yet ("Are you already on the ballot?" → qualified-not-filed or considering).
// Getting on the ballot is the gating task for both, so the card leads them into
// the manager, which answers with the filing steps for their office and state.
// The other two ballot answers get their own cards later; until then this
// renders nothing for them.
export default function GetOnBallotCard({
  onGetOnBallot,
}: Props): React.JSX.Element | null {
  const [campaign] = useCampaign()
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    try {
      if (window.localStorage.getItem(BALLOT_DISMISSED_KEY) === '1') {
        setDismissed(true)
      }
    } catch {
      // Storage disabled: leave it shown.
    }
  }, [])

  const onSkip = (): void => {
    try {
      window.localStorage.setItem(BALLOT_DISMISSED_KEY, '1')
    } catch {
      // Storage disabled: hide for this session only.
    }
    setDismissed(true)
  }

  // Onboarding persists this answer twice, and older campaigns only have the
  // second copy: details.ballotStatus was stripped by the update schema's
  // allowlist until it was added there, while the whole-answers snapshot under
  // data.onboarding always passed through. Read both so already-onboarded
  // candidates get the card, matching the fallback gp-api's campaign manager
  // uses to build its ballot-access guidance.
  const ballotStatus: BallotStatus | undefined =
    campaign?.details?.ballotStatus ?? campaign?.data?.onboarding?.ballotStatus
  const copy =
    ballotStatus === 'qualified-not-filed' || ballotStatus === 'considering'
      ? BALLOT_CARD_COPY[ballotStatus]
      : null

  if (dismissed || !copy) return null

  return (
    <ManagerPromptCard
      title={copy.title}
      description={copy.description}
      ctaLabel={copy.ctaLabel}
      onCta={onGetOnBallot}
      onSkip={onSkip}
    />
  )
}
