'use client'

import { useEffect, useState } from 'react'
import type { OutreachGateState } from './useOutreachGate'

// Whether this attempt started behind the Pro wall, frozen once per open so
// the stages after an in-flow upgrade still belong to a locked attempt. Null
// until the gate has resolved: membership loads asynchronously, and reading
// the placeholder null would report a free candidate's first step unlocked.
export const useLockedAtOpen = (
  open: boolean,
  gate: OutreachGateState,
): boolean | null => {
  const [locked, setLocked] = useState<boolean | null>(null)

  useEffect(() => {
    if (!open) {
      setLocked(null)
      return
    }
    if (locked !== null || !gate.resolved) return
    setLocked(gate.requirement === 'pro')
  }, [open, locked, gate.resolved, gate.requirement])

  return locked
}
