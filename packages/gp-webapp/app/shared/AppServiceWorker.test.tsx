import { render, waitFor } from '@testing-library/react'
import { SerwistProvider } from '@serwist/next/react'
import { expect, it, onTestFinished, vi } from 'vitest'

const { faro } = vi.hoisted(() => ({ faro: { api: { pushLog: vi.fn() } } }))
vi.mock('@grafana/faro-web-sdk', () => ({
  faro,
  LogLevel: { WARN: 'warn', INFO: 'info', ERROR: 'error' },
}))

import AppServiceWorker from './AppServiceWorker'

const stubReload = () => {
  const reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
  onTestFinished(() => {
    vi.unstubAllGlobals()
  })
  return reload
}

// The section `AppServiceWorker` registers with is `window.serwist`, which
// `SerwistProvider` fills in. It stays empty here: the provider's `disable`
// is true outside `next build`'s production mode, so the test supplies it.
const stubSerwist = (register: () => Promise<unknown>) => {
  const target = window as unknown as { serwist?: unknown }
  target.serwist = { register }
  onTestFinished(() => {
    delete target.serwist
  })
  vi.clearAllMocks()
}

// What the test below guards against. Serwist adds its reload listener
// whether or not a worker registers, so it reloads here too, where none can.
it('is up against a reload Serwist makes by default', () => {
  const reload = stubReload()

  render(<SerwistProvider swUrl="/sw.js" disable />)
  window.dispatchEvent(new Event('online'))

  expect(reload).toHaveBeenCalledTimes(1)
})

// A door-knocking walk lives in the page's state, and the offline queue
// sends what the phone held the moment signal returns. A reload on
// reconnecting would end the walk and cut that send off mid-upload.
it('leaves the page alone when signal comes back', () => {
  const reload = stubReload()

  render(<AppServiceWorker />)
  window.dispatchEvent(new Event('online'))

  expect(reload).not.toHaveBeenCalled()
})

it('registers the worker itself, now that the provider was told not to', () => {
  const register = vi.fn().mockResolvedValue(undefined)
  stubSerwist(register)

  render(<AppServiceWorker />)

  expect(register).toHaveBeenCalledTimes(1)
})

// A refusal is a DOMException the browser raises, with no stack frame, and
// the spec makes conditions fatal that this app cannot change (a redirected
// script fetch, for one). Left as `SerwistProvider`'s `void register()` it is
// an unhandled rejection, which Faro reports as a brand-new front-end
// exception, and the alert files a ticket per browser condition.
it('reports a refused registration as a log line, not an exception', async () => {
  const refusal = new Error(
    "SecurityError: Failed to register a ServiceWorker for scope ('https://app.goodparty.org/') with script ('https://app.goodparty.org/sw.js'): The script resource is behind a redirect, which is disallowed.",
  )
  stubSerwist(vi.fn().mockRejectedValue(refusal))

  render(<AppServiceWorker />)

  await waitFor(() => expect(faro.api.pushLog).toHaveBeenCalledTimes(1))
  expect(faro.api.pushLog).toHaveBeenCalledWith(
    ['Service worker registration refused', refusal],
    { level: 'warn', context: { component: 'AppServiceWorker' } },
  )
})

it('reports nothing when the worker registers', async () => {
  stubSerwist(vi.fn().mockResolvedValue(undefined))

  render(<AppServiceWorker />)

  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(faro.api.pushLog).not.toHaveBeenCalled()
})
