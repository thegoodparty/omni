'use client'

import { useEffect, useRef } from 'react'

// Reports a card's live dictation-active state up to the parent, and reports
// `false` once on unmount so a step/row that goes away mid-recording can't leave
// the parent's gate stuck true. Keeps the callback in a ref so a changing
// callback identity doesn't retrigger the reporting effect (which would flicker
// false→true). No-op when `report` is undefined (e.g. the dashboard page, which
// doesn't gate on dictation).
export const useReportDictationActive = (
  active: boolean,
  report?: (active: boolean) => void,
): void => {
  const reportRef = useRef(report)
  useEffect(() => {
    reportRef.current = report
  }, [report])

  useEffect(() => {
    reportRef.current?.(active)
  }, [active])

  useEffect(() => () => reportRef.current?.(false), [])
}
