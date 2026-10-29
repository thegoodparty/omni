// No 'use client': both Homes that render it are client components.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, cn } from '@styleguide'
import { usePositionName } from '@shared/hooks/usePositionName'
import { FREE_OFFER_CARD_CLASS } from '../shared/robocallFreeOffer/freeOfferStyles'
import { ASK_COPY } from '../election-result/electionResultCopy'
import { useCampaignManagerChat } from './CampaignManagerChatProvider'

// "Did you win?" on Home, while the question is open. Home is spared the
// election result page's redirect so the chat can ask; this card keeps the
// question in front of the candidate once they close the chat. It reads the
// chat's own state, so it only shows where that chat mounts, and answering
// either one closes both.
export default function ElectionResultHomeCard(): React.JSX.Element | null {
  const chat = useCampaignManagerChat()
  const router = useRouter()
  const positionName = usePositionName()
  const [saving, setSaving] = useState(false)
  const question = chat?.electionResult
  if (!question?.pending) return null

  const answerLost = async (): Promise<void> => {
    setSaving(true)
    if (await question.saveLoss()) {
      router.replace('/dashboard/election-result/loss')
      return
    }
    setSaving(false)
  }

  return (
    <Card
      className={cn(
        'w-full gap-3 rounded-2xl p-4 shadow-xs',
        FREE_OFFER_CARD_CLASS,
      )}
      data-testid="election-result-home-card"
    >
      <h3 className="text-base font-semibold">
        {ASK_COPY.title(positionName || null)}
      </h3>
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="small" onClick={question.answerWon} disabled={saving}>
          {ASK_COPY.won}
        </Button>
        <Button
          size="small"
          variant="outline"
          onClick={() => void answerLost()}
          disabled={saving}
          loading={saving}
        >
          {ASK_COPY.lost}
        </Button>
        <Button
          size="small"
          variant="outline"
          onClick={question.snooze}
          disabled={saving}
        >
          {ASK_COPY.notFinal}
        </Button>
      </div>
    </Card>
  )
}
