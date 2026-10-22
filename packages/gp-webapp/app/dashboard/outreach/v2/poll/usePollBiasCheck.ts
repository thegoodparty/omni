import { useCallback, useEffect, useRef, useState } from 'react'
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

// The analyzer has nothing to say about a fragment; the legacy editor used the
// same floor.
const CHECK_MIN_LENGTH = 21
// How long typing has to pause before the question counts as finished.
const CHECK_DEBOUNCE_MS = 2000

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

export const usePollBiasCheck = (question: string, enabled: boolean) => {
  const text = question.trim()
  const [result, setResult] = useState<CheckResult | null>(null)
  const [checkingText, setCheckingText] = useState<string | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [improving, setImproving] = useState(false)
  const inFlight = useRef<{ text: string; promise: Promise<Settled> } | null>(
    null,
  )

  const status: BiasCheckStatus =
    text.length < CHECK_MIN_LENGTH
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
        setResult({
          text,
          biasSpans: data.bias_spans,
          rewrittenText: data.rewritten_text,
        })
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

  useEffect(() => {
    if (!enabled || status !== 'idle') return
    const timer = setTimeout(() => {
      void check()
    }, CHECK_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [enabled, status, check])

  const improve = useCallback(async (): Promise<string | null> => {
    trackEvent(EVENTS.createPoll.pollQuestionOptimized)
    setImproving(true)
    try {
      if (result?.text === text) return result.rewrittenText
      const data = await analyze(text)
      return data.rewritten_text
    } catch {
      return null
    } finally {
      setImproving(false)
    }
  }, [result, text])

  const reset = useCallback(() => {
    inFlight.current = null
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
    ensureChecked,
    improve,
    improving,
    flaggedSpans,
    reset,
  }
}
