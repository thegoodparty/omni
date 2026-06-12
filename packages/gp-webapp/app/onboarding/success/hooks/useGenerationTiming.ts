'use client'

import { useEffect, useRef } from 'react'

export interface GenerationTiming {
  generated: boolean
  generationTimeMs?: number
}

// Web-side timing for the plan's async resources. The generation endpoints
// double as fetch endpoints, so response latency alone can't tell the PM
// whether a `*ResultsReceived` event was a real generation or a cache hit.
// The unambiguous signal is the server's own status: a cache fetch never
// reports `generating`. So we mark a resource as generated only if the
// caller ever observed that status, and measure the wait from this
// component's mount — i.e. how long the user actually watched a skeleton.
// (Total server-side generation time is tracked separately in gp-api.)
//
// Returns a getter so the elapsed time is read at event-fire time, not at
// render time.
export const useGenerationTiming = (
  isGenerating: boolean,
): (() => GenerationTiming) => {
  const startedAtMs = useRef(Date.now())
  const sawGenerating = useRef(false)

  useEffect(() => {
    if (isGenerating) {
      sawGenerating.current = true
    }
  }, [isGenerating])

  return () =>
    sawGenerating.current
      ? { generated: true, generationTimeMs: Date.now() - startedAtMs.current }
      : { generated: false }
}
