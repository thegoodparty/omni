'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CONSTITUENT_FEEDBACK_TRANSCRIPT_MAX_LENGTH,
  type ConfirmedConstituentFeedbackIssue,
  type PendingFeedback,
  type PendingFeedbackReference,
} from '@goodparty_org/contracts'
import {
  ArrowLeftIcon,
  Button,
  EmptyState,
  Spinner,
  Textarea,
} from '@styleguide'
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

const NAME_WORDS = 6

const noteName = (memo: PendingFeedback, copy: WhatWeHeardCopy): string => {
  const words = memo.transcript?.split(/\s+/).filter(Boolean) ?? []
  if (words.length === 0) return copy.noteFrom(memo.actorName, memo.occurredAt)
  const lead = words.slice(0, NAME_WORDS).join(' ')
  return words.length > NAME_WORDS ? `${lead}…` : lead
}

const PendingMemo = ({
  memo,
  outreachId,
  isServe,
  copy,
}: {
  memo: PendingFeedback
  outreachId: number
  isServe: boolean
  copy: WhatWeHeardCopy
}) => {
  const queryClient = useQueryClient()
  const noteId = useId()
  const [typing, setTyping] = useState(false)
  const [typed, setTyped] = useState('')
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: pendingQueryKey(outreachId) }),
      queryClient.invalidateQueries({ queryKey: reportQueryKey(outreachId) }),
    ])

  const confirm = useMutation({
    mutationFn: (issues: ConfirmedConstituentFeedbackIssue[]) =>
      clientRequest('PATCH /v1/constituent-feedback/:id/confirm', {
        id: memo.id,
        issues,
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

  // A typed note is recorded again as the memo's text, exactly as a typed
  // memo at the door would be, so it is extracted like any other and has a
  // transcript for synthesis to group. The re-read then shows its card.
  const record = useMutation({
    mutationFn: (input: {
      reference: PendingFeedbackReference
      transcript: string
    }) =>
      clientRequest('POST /v1/constituent-feedback', {
        ...input.reference,
        clientKey: memo.clientKey,
        transcript: input.transcript,
        captureMethod: 'typed',
      }),
    onSuccess: async () => {
      await refresh()
      setTyping(false)
      setTyped('')
    },
  })

  const retry = useMutation({
    mutationFn: () =>
      clientRequest('POST /v1/constituent-feedback/:id/retry', {
        id: memo.id,
      }),
    onSuccess: refresh,
  })

  const name = noteName(memo, copy)

  if (memo.extractionStatus === 'pending') {
    return (
      <p className="text-sm text-muted-foreground">{copy.stillTranscribing}</p>
    )
  }

  if (memo.extractionStatus === 'extracted') {
    return (
      <div className="flex flex-col gap-3">
        <IssueCaptureConfirmCard
          proposed={{ issues: memo.issues }}
          saving={confirm.isPending}
          isServe={isServe}
          onConfirm={(issues) => confirm.mutate(issues)}
          confirmLabel={copy.confirmFor(name)}
        />
        {confirm.isError && (
          <p role="alert" className="text-sm text-destructive">
            {copy.confirmFailed}
          </p>
        )}
      </div>
    )
  }

  const { reference } = memo
  if (typing && reference !== null) {
    const transcript = typed.trim()
    return (
      <div className="flex flex-col gap-2">
        <label
          htmlFor={noteId}
          className="text-xs font-semibold uppercase tracking-[0.03em] text-muted-foreground"
        >
          {copy.typeLabel}
        </label>
        <Textarea
          id={noteId}
          value={typed}
          maxLength={CONSTITUENT_FEEDBACK_TRANSCRIPT_MAX_LENGTH}
          placeholder={copy.typePlaceholder}
          rows={3}
          onChange={(e) => setTyped(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="small"
            disabled={transcript === '' || record.isPending}
            onClick={() => record.mutate({ reference, transcript })}
          >
            {copy.saveNote}
          </Button>
          <Button
            variant="outline"
            size="small"
            disabled={record.isPending}
            onClick={() => setTyping(false)}
          >
            {copy.cancel}
          </Button>
        </div>
        {record.isError && (
          <p role="alert" className="text-sm text-destructive">
            {copy.confirmFailed}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {memo.transcript === null ? copy.couldNotHear : copy.couldNotRead}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="small"
          disabled={retry.isPending}
          aria-label={copy.tryAgainFor(name)}
          onClick={() => retry.mutate()}
        >
          {copy.tryAgain}
        </Button>
        {reference !== null && (
          <Button
            variant="outline"
            size="small"
            aria-label={copy.typeItInsteadFor(name)}
            onClick={() => setTyping(true)}
          >
            {copy.typeItInstead}
          </Button>
        )}
      </div>
      {retry.isError && (
        <p role="alert" className="text-sm text-destructive">
          {copy.retryFailed}
        </p>
      )}
    </div>
  )
}

interface PendingMemoListProps {
  outreachId: number
  isServe: boolean
  // Where the back arrow goes: the report by default, the walk on the
  // volunteer's page.
  back?: { href: string; label: string }
}

// "Notes to review": an effort's memos nobody who was there has confirmed,
// each with the card the canvasser would have seen at the door. It is where
// a memo recorded with no signal is confirmed once it is transcribed, and
// the retry for any memo whose transcription or extraction failed. Mounted
// by the manager's page and the volunteer's; a volunteer sees only their
// own, which the API decides.
const PendingMemoList = ({
  outreachId,
  isServe,
  back,
}: PendingMemoListProps) => {
  const copy = whatWeHeardCopy(isServe)
  const pendingQuery = useQuery(pendingQueryOptions(outreachId))
  const memos = pendingQuery.data

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <Link
            href={back?.href ?? `/dashboard/issue-capture/${outreachId}`}
            aria-label={back?.label ?? copy.back}
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
          <p role="alert" className="text-sm text-destructive">
            {copy.loadFailed}
          </p>
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
              {/* Polite and always there, so a note that finishes
                  transcribing while the page is open is announced as ready
                  rather than silently swapping in its card. */}
              <p role="status" className="sr-only">
                {memo.extractionStatus === 'pending'
                  ? copy.stillTranscribing
                  : memo.extractionStatus === 'extracted'
                    ? copy.readyToReview
                    : ''}
              </p>
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
