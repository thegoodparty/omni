// No 'use client': every caller is a client component.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, cn } from '@styleguide'
import { useCampaign } from '@shared/hooks/useCampaign'
import { usePositionName } from '@shared/hooks/usePositionName'
import {
  ASK_COPY,
  HOME_CARD_COPY,
  electionDayLabel,
} from '../election-result/electionResultCopy'
import { electionDateOf } from '../election-result/electionResultQuestion'
import { useCampaignManagerChat } from './CampaignManagerChatProvider'
import type { ElectionResultChat } from './useElectionResultChat'

// Home's quiet buttons: they share one row on a phone, like the deck's.
const QUIET_ON_PHONE =
  'max-sm:flex-1 max-sm:h-8 max-sm:px-4 max-sm:py-2 max-sm:text-sm'

// "Did you win?" as the first card in Home's deck, while the question is
// open. Home is spared the election result page's redirect so the chat can
// ask; this card keeps the question in front of the candidate once they close
// the chat. It reads the chat's own state, so it only shows where that chat
// mounts, and answering either one closes both.
export default function ElectionResultHomeCard({
  className,
}: {
  className?: string
}): React.JSX.Element | null {
  const question = useCampaignManagerChat()?.electionResult
  if (!question?.pending) return null
  return <QuestionCard question={question} className={className} />
}

const QuestionCard = ({
  question,
  className,
}: {
  question: ElectionResultChat
  className?: string
}): React.JSX.Element => {
  const router = useRouter()
  const [campaign] = useCampaign()
  const positionName = usePositionName()
  const [saving, setSaving] = useState(false)

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
        'relative min-h-20 gap-0 rounded-2xl border-components-input-border py-0',
        className,
      )}
      data-testid="election-result-home-card"
    >
      <div className="flex flex-col gap-1 px-6 py-5">
        <h3 className="font-opensans text-lg font-medium text-card-foreground">
          {ASK_COPY.title(positionName || null)}
        </h3>
        <p className="text-sm text-muted-foreground">
          {HOME_CARD_COPY.description(
            electionDayLabel(electionDateOf(campaign)),
          )}
        </p>
        <div className="flex flex-col gap-2 pt-5 sm:flex-row sm:flex-wrap sm:items-center">
          <Button
            type="button"
            size="medium"
            className="w-full sm:w-auto"
            onClick={question.answerWon}
            disabled={saving}
          >
            {HOME_CARD_COPY.won}
          </Button>
          <div className="flex items-center gap-2 max-sm:mt-2 sm:contents">
            <Button
              type="button"
              variant="outline"
              size="medium"
              className={QUIET_ON_PHONE}
              onClick={() => void answerLost()}
              disabled={saving}
              loading={saving}
            >
              {HOME_CARD_COPY.lost}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="medium"
              className={cn(QUIET_ON_PHONE, 'sm:ml-auto')}
              onClick={question.snooze}
              disabled={saving}
            >
              {HOME_CARD_COPY.notFinal}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
