'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ConstituentFeedbackRecord,
  ConstituentFeedbackTriple,
} from '@goodparty_org/contracts'
import { ArrowLeftIcon, Button, EmptyState, Spinner } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { outreachProduct } from 'app/dashboard/outreach/util/outreachAnalytics'
import IssueCaptureConfirmCard from 'app/dashboard/door-knocking/native/IssueCaptureConfirmCard'
import { ANALYTICS_CHANNEL } from '../../../analytics'
import { whatWeHeardCopy, type WhatWeHeardCopy } from '../../../copy'
import {
  pendingQueryKey,
  pendingQueryOptions,
  reportQueryKey,
} from '../../queries'

const HOUR_MS = 60 * 60 * 1000

const PendingMemo = ({
  memo,
  outreachId,
  isServe,
  copy,
}: {
  memo: ConstituentFeedbackRecord
  outreachId: number
  isServe: boolean
  copy: WhatWeHeardCopy
}) => {
  const queryClient = useQueryClient()
  const [typing, setTyping] = useState(false)
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: pendingQueryKey(outreachId) }),
      queryClient.invalidateQueries({ queryKey: reportQueryKey(outreachId) }),
    ])

  const confirm = useMutation({
    mutationFn: (triple: ConstituentFeedbackTriple) =>
      clientRequest('PATCH /v1/constituent-feedback/:id/confirm', {
        id: memo.id,
        ...triple,
      }),
    onSuccess: () => {
      trackEvent(EVENTS.IssueCapture.PendingMemoConfirmed, {
        channel:
          memo.channel === 'phone_bank'
            ? ANALYTICS_CHANNEL.phone_bank
            : ANALYTICS_CHANNEL.door_knock,
        product: outreachProduct(isServe),
        // How long a note waited for someone who was there, to a tenth of
        // an hour.
        ageHours:
          Math.round(
            ((Date.now() - new Date(memo.occurredAt).getTime()) / HOUR_MS) * 10,
          ) / 10,
      })
      return refresh()
    },
  })

  const retry = useMutation({
    mutationFn: () =>
      clientRequest('POST /v1/constituent-feedback/:id/retry', {
        id: memo.id,
      }),
    onSuccess: refresh,
  })

  if (memo.extractionStatus === 'pending') {
    return (
      <p className="text-sm text-muted-foreground">{copy.stillTranscribing}</p>
    )
  }

  const extracted = memo.extractionStatus === 'extracted'

  return (
    <div className="flex flex-col gap-3">
      {!extracted && !typing && (
        <>
          <p className="text-sm text-muted-foreground">
            {memo.transcript === null ? copy.couldNotHear : copy.couldNotRead}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="small"
              disabled={retry.isPending}
              onClick={() => retry.mutate()}
            >
              {copy.tryAgain}
            </Button>
            <Button
              variant="outline"
              size="small"
              onClick={() => setTyping(true)}
            >
              {copy.typeItInstead}
            </Button>
          </div>
          {retry.isError && (
            <p className="text-sm text-destructive">{copy.retryFailed}</p>
          )}
        </>
      )}
      {(extracted || typing) && (
        <IssueCaptureConfirmCard
          proposed={
            extracted
              ? {
                  issueLabel: memo.issueLabel,
                  stance: memo.stance,
                  desiredOutcome: memo.desiredOutcome,
                }
              : null
          }
          saving={confirm.isPending}
          isServe={isServe}
          onConfirm={(triple) => confirm.mutate(triple)}
          // Typing is the one step here there is a way back from.
          {...(typing ? { onSkip: () => setTyping(false) } : {})}
        />
      )}
      {confirm.isError && (
        <p className="text-sm text-destructive">{copy.confirmFailed}</p>
      )}
    </div>
  )
}

interface PendingMemoListProps {
  outreachId: number
  isServe: boolean
}

// "Notes to review": an effort's memos nobody who was there has confirmed,
// each with the card the canvasser would have seen at the door. It is where
// a memo recorded with no signal is confirmed once it is transcribed, and
// the retry for any memo whose transcription or extraction failed. A
// volunteer sees only their own; the API decides that.
const PendingMemoList = ({ outreachId, isServe }: PendingMemoListProps) => {
  const copy = whatWeHeardCopy(isServe)
  const pendingQuery = useQuery(pendingQueryOptions(outreachId))
  const memos = pendingQuery.data

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <Link
            href={`/dashboard/issue-capture/${outreachId}`}
            aria-label={copy.back}
            className="text-foreground"
          >
            <ArrowLeftIcon size={20} />
          </Link>
          <h1 className="text-2xl font-semibold text-foreground">
            {copy.reviewTitle}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">{copy.reviewCaption}</p>
      </header>
      {memos === undefined ? (
        pendingQuery.isError ? (
          <p className="text-sm text-destructive">{copy.loadFailed}</p>
        ) : (
          <div className="flex items-center justify-center gap-3 py-20">
            <Spinner />
            <p className="text-base text-foreground">{copy.loading}</p>
          </div>
        )
      ) : memos.length === 0 ? (
        <EmptyState message={copy.reviewEmpty} />
      ) : (
        <ul className="flex flex-col gap-4">
          {memos.map((memo) => (
            <li
              key={memo.id}
              className="flex flex-col gap-2 rounded-lg border border-border p-4"
            >
              <p className="text-xs font-medium text-muted-foreground">
                {copy.summaryBy(memo.actorName)}
              </p>
              {memo.transcript !== null && (
                <p className="text-sm italic text-foreground">
                  {memo.transcript}
                </p>
              )}
              <PendingMemo
                memo={memo}
                outreachId={outreachId}
                isServe={isServe}
                copy={copy}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default PendingMemoList
