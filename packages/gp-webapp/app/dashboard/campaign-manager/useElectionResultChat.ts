// No 'use client': only CampaignManagerChatProvider, a client module, uses it.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { updateCampaign } from 'app/onboarding/shared/ajaxActions'
import { useSnackbar } from 'helpers/useSnackbar'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useUser } from '@shared/hooks/useUser'
import { usePositionName } from '@shared/hooks/usePositionName'
import { useIsImpersonating } from '@shared/hooks/useIsImpersonating'
import { CAMPAIGN_QUERY_KEY } from '@shared/hooks/CampaignProvider'
import { useServePlace } from 'app/dashboard/contacts/citizens-panel/managedPanelCopy'
import {
  isElectionResultDismissed,
  isElectionResultSnoozed,
  snoozeElectionResult,
} from 'app/dashboard/election-result/dismissal'
import {
  electionDateOf,
  isElectionResultPending,
} from 'app/dashboard/election-result/electionResultQuestion'
import {
  CHAT_ASK_COPY,
  COMMUNITY_URL,
  electionDayLabel,
} from 'app/dashboard/election-result/electionResultCopy'
import type { ChatSuggestion } from '../chief-of-staff/components/chat/ChiefOfStaffChatBody'

type Answer = 'lost' | 'not-final'

export interface ElectionResultChat {
  // The question is open, or was just answered in this chat session.
  asking: boolean
  // Still unanswered: the manager home opens the chat on it.
  pending: boolean
  opener: string[]
  openerKey: string
  suggestions: ChatSuggestion[]
  // Called when the chat closes, so the next open is the usual manager.
  reset: () => void
}

/**
 * The campaign manager's "How did it go?" (C1): asked from the day after
 * election day, alongside the election result page, until either is answered.
 * "I won" opens that page on its congratulations; "I didn't win" saves the
 * result and thanks them here (C4); "Results aren't final yet" hides the
 * question on both for 3 days.
 */
export const useElectionResultChat = (): ElectionResultChat => {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { errorSnackbar } = useSnackbar()
  const [campaign] = useCampaign()
  const [user] = useUser()
  const positionName = usePositionName()
  const place = useServePlace()
  const isImpersonating = useIsImpersonating()

  // Storage is unreadable during render on the server, so the question waits
  // for this effect rather than flashing for a candidate who snoozed it.
  const [held, setHeld] = useState(true)
  useEffect(() => {
    setHeld(
      isElectionResultSnoozed(campaign?.id) ||
        (isImpersonating && isElectionResultDismissed()),
    )
  }, [campaign?.id, isImpersonating])

  const [answer, setAnswer] = useState<Answer | null>(null)
  const pending = !held && isElectionResultPending(campaign)

  const answerLost = useCallback(async (): Promise<void> => {
    const updated = await updateCampaign([
      { key: 'details.wonGeneral', value: false },
    ])
    if (!updated) {
      errorSnackbar(CHAT_ASK_COPY.saveFailed)
      return
    }
    if (campaign) {
      queryClient.setQueryData(CAMPAIGN_QUERY_KEY, {
        ...campaign,
        details: { ...campaign.details, wonGeneral: false },
      })
    }
    setAnswer('lost')
  }, [campaign, errorSnackbar, queryClient])

  const answerNotFinal = useCallback((): void => {
    if (campaign) snoozeElectionResult(campaign.id)
    setHeld(true)
    setAnswer('not-final')
  }, [campaign])

  const opener = useMemo(() => {
    if (answer === 'lost') {
      return CHAT_ASK_COPY.lostReply(user?.firstName, place)
    }
    if (answer === 'not-final') return CHAT_ASK_COPY.notFinalReply
    return CHAT_ASK_COPY.opener(
      electionDayLabel(electionDateOf(campaign)),
      positionName || null,
    )
  }, [answer, user?.firstName, place, campaign, positionName])

  const suggestions = useMemo<ChatSuggestion[]>(() => {
    if (answer === 'lost') {
      return [
        {
          label: CHAT_ASK_COPY.community.label,
          description: CHAT_ASK_COPY.community.description,
          onSelect: () => {
            window.open(COMMUNITY_URL, '_blank', 'noopener,noreferrer')
          },
        },
      ]
    }
    if (answer === 'not-final') return []
    return [
      {
        label: CHAT_ASK_COPY.won,
        onSelect: () => router.push('/dashboard/election-result?result=won'),
      },
      { label: CHAT_ASK_COPY.lost, onSelect: () => void answerLost() },
      { label: CHAT_ASK_COPY.notFinal, onSelect: answerNotFinal },
    ]
  }, [answer, router, answerLost, answerNotFinal])

  const reset = useCallback(() => setAnswer(null), [])

  return {
    asking: pending || answer !== null,
    pending,
    opener,
    openerKey: `election-result-${answer ?? 'ask'}`,
    suggestions,
    reset,
  }
}
