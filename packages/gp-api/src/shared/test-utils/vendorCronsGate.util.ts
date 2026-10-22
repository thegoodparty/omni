import { onTestFinished } from 'vitest'

// VENDOR_CRONS_ENABLED is a module-level constant, so a test cannot flip it by
// stubbing env. A test file that needs to drive the gate mocks the module with
// withVendorCronsGate (see below) and calls disableVendorCrons() for the
// "non-prod live" case. The test env is mock mode, so the gate is on by default.
export const vendorCronsGate = { enabled: true }

export const withVendorCronsGate = <T extends object>(actual: T): T =>
  Object.defineProperty({ ...actual }, 'VENDOR_CRONS_ENABLED', {
    get: () => vendorCronsGate.enabled,
    enumerable: true,
  })

// Simulates a non-prod deploy in live mode for the rest of the current test.
export const disableVendorCrons = (): void => {
  vendorCronsGate.enabled = false
  onTestFinished(() => {
    vendorCronsGate.enabled = true
  })
}
