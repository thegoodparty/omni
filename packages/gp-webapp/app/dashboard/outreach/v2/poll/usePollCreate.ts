import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ServePollCreate,
  ServePollCreateResponse,
  ServePollDraftRequest,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'

export const draftPollQuestion = async (
  input: ServePollDraftRequest,
): Promise<string> => {
  const { data } = await clientRequest(
    'POST /v1/outreach/serve/poll/draft',
    input,
  )
  return data.question
}

export const createServePoll = async (
  input: ServePollCreate,
): Promise<ServePollCreateResponse> => {
  const { data } = await clientRequest('POST /v1/outreach/serve/poll', input)
  return data
}

interface UsePollCreateInput {
  // True on the review step: entering it writes the pending_payment row whose
  // id the checkout session needs.
  enabled: boolean
  // Null until everything the create needs is chosen.
  payload: ServePollCreate | null
}

export interface PollCreate {
  created: ServePollCreateResponse | null
  failed: boolean
  // Back off review: the row stays pending_payment and unseen, and re-entry
  // writes a fresh one for the edited poll.
  discard: () => void
}

export const usePollCreate = ({
  enabled,
  payload,
}: UsePollCreateInput): PollCreate => {
  const [created, setCreated] = useState<ServePollCreateResponse | null>(null)
  const [failed, setFailed] = useState(false)
  const inFlightRef = useRef(false)
  const generationRef = useRef(0)
  const payloadRef = useRef(payload)
  payloadRef.current = payload

  useEffect(() => {
    const body = payloadRef.current
    if (!enabled || created || failed || inFlightRef.current || !body) return
    inFlightRef.current = true
    const generation = generationRef.current
    ;(async () => {
      try {
        const result = await createServePoll(body)
        // A create that started before Back must not resurrect its id:
        // checkout would then bill the pre-edit poll.
        if (generation === generationRef.current) setCreated(result)
      } catch {
        if (generation === generationRef.current) setFailed(true)
      } finally {
        if (generation === generationRef.current) inFlightRef.current = false
      }
    })()
  }, [enabled, created, failed])

  const discard = useCallback(() => {
    generationRef.current += 1
    inFlightRef.current = false
    setCreated(null)
    setFailed(false)
  }, [])

  return { created, failed, discard }
}
