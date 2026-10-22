import { useCallback, useRef, useState } from 'react'
import { POLL_QUESTION_MIN_LENGTH } from '@goodparty_org/contracts'
import { clientFetch } from 'gpApi/clientFetch'
import { apiRoutes } from 'gpApi/routes'
import type {
  BiasAnalysisResponse,
  Span,
} from 'app/dashboard/polls/shared/components/poll-text-bias/hooks/usePollBiasAnalysis'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

export type BiasCheckStatus =
  | 'unavailable'
  | 'idle'
  | 'checking'
  | 'passed'
  | 'flagged'
  | 'error'

interface CheckResult {
  text: string
  biasSpans: Span[]
  rewrittenText: string
}

type Settled = 'passed' | 'flagged' | 'error'

const analyze = async (text: string): Promise<BiasAnalysisResponse> => {
  const response = await clientFetch<BiasAnalysisResponse>(
    apiRoutes.polls.analyzeBias,
    { pollText: text },
  )
  if (!response.ok || !response.data) throw new Error(response.statusText)
  return response.data
}

export const usePollBiasCheck = (question: string) => {
  const text = question.trim()
  const [result, setResult] = useState<CheckResult | null>(null)
  const [checkingText, setCheckingText] = useState<string | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [improving, setImproving] = useState(false)
  const improveId = useRef(0)
  const inFlight = useRef<{ text: string; promise: Promise<Settled> } | null>(
    null,
  )
  // The last answer, read by Improve after awaiting a check already on its
  // way, where the state from that render is not yet updated.
  const latest = useRef<CheckResult | null>(null)

  const status: BiasCheckStatus =
    // Checked from the length Continue accepts, so nothing that can be sent
    // goes unchecked.
    text.length < POLL_QUESTION_MIN_LENGTH
      ? 'unavailable'
      : checkingText === text
        ? 'checking'
        : result?.text === text
          ? result.biasSpans.length > 0
            ? 'flagged'
            : 'passed'
          : errorText === text
            ? 'error'
            : 'idle'

  const check = useCallback((): Promise<Settled> => {
    if (inFlight.current?.text === text) return inFlight.current.promise
    setCheckingText(text)
    setErrorText(null)
    const promise = analyze(text)
      .then((data): Settled => {
        const answer = {
          text,
          biasSpans: data.bias_spans,
          rewrittenText: data.rewritten_text,
        }
        latest.current = answer
        setResult(answer)
        if (data.bias_spans.length > 0) {
          trackEvent(EVENTS.createPoll.pollBiasDetectionShown)
          return 'flagged'
        }
        return 'passed'
      })
      .catch((): Settled => {
        setErrorText(text)
        return 'error'
      })
      .finally(() => {
        if (inFlight.current?.promise === promise) inFlight.current = null
        setCheckingText((current) => (current === text ? null : current))
      })
    inFlight.current = { text, promise }
    return promise
  }, [text])

  // Settles the current question before the step moves on: a pass or a
  // failed check lets it go, a flag holds it so the official sees why.
  const ensureChecked = useCallback(async (): Promise<Settled | null> => {
    if (status === 'unavailable') return null
    if (status === 'passed' || status === 'flagged' || status === 'error') {
      return status
    }
    return check()
  }, [status, check])

  // Leaving the field is when the question counts as written, as it was in
  // the legacy editor: a check per pause in typing would call the analyzer,
  // a model, far more often for the same result.
  const checkOnLeave = useCallback(() => {
    if (status === 'idle') void check()
  }, [status, check])

  const improve = useCallback(async (): Promise<string | null> => {
    trackEvent(EVENTS.createPoll.pollQuestionOptimized)
    const id = ++improveId.current
    setImproving(true)
    try {
      // A check already asking about these words carries the rewrite too.
      if (inFlight.current?.text === text) await inFlight.current.promise
      if (latest.current?.text === text) return latest.current.rewrittenText
      const data = await analyze(text)
      return data.rewritten_text
    } catch {
      return null
    } finally {
      // A reset since has already cleared it, and must not be undone.
      if (id === improveId.current) setImproving(false)
    }
  }, [text])

  const reset = useCallback(() => {
    inFlight.current = null
    latest.current = null
    improveId.current += 1
    setImproving(false)
    setResult(null)
    setCheckingText(null)
    setErrorText(null)
  }, [])

  const flaggedSpans =
    status === 'flagged' && result
      ? result.biasSpans.map((span) => ({
          phrase: result.text.slice(span.start, span.end),
          reason: span.reason,
        }))
      : []

  return {
    status,
    check,
    checkOnLeave,
    ensureChecked,
    improve,
    improving,
    flaggedSpans,
    reset,
  }
}
