import { useSyncExternalStore } from 'react'
import type { OutreachGateState } from '../useOutreachGate'

// The gate stand-in every flow test mounts. It is REACTIVE rather than a
// plain assignment because the requirement clearing MID-FLOW (the candidate
// upgrades inside the sheet) is its own behavior, and a test has to be able
// to make that happen while the flow is on screen.
//
// A module singleton rather than a `vi.hoisted` ref: a `vi.mock` factory
// cannot close over a test file's own variables, but it can `await import`
// this module and hand back the same store the test file imported. Vitest
// isolates modules per test file, so one file's gate never reaches another's.

const DEFAULT_STATE: OutreachGateState = {
  enabled: false,
  requirement: null,
  twoStep: true,
  membership: null,
  tcrCompliance: null,
}

let state: OutreachGateState = DEFAULT_STATE
const listeners = new Set<() => void>()

const subscribe = (onChange: () => void): (() => void) => {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

const snapshot = (): OutreachGateState => state

export const gateRef = {
  get current(): OutreachGateState {
    return state
  },
  set(next: OutreachGateState): void {
    state = next
    listeners.forEach((listener) => listener())
  },
}

export const useMockOutreachGate = (): OutreachGateState =>
  useSyncExternalStore(subscribe, snapshot, snapshot)
