import { render } from '@testing-library/react'
import { SerwistProvider } from '@serwist/next/react'
import { expect, it, onTestFinished, vi } from 'vitest'
import AppServiceWorker from './AppServiceWorker'

const stubReload = () => {
  const reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
  onTestFinished(() => {
    vi.unstubAllGlobals()
  })
  return reload
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
