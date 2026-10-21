import { render } from '@testing-library/react'
import { expect, it, onTestFinished, vi } from 'vitest'
import AppServiceWorker from './AppServiceWorker'

// A door-knocking walk lives in the page's state, and the offline queue
// sends what the phone held the moment signal returns. A reload on
// reconnecting would end the walk and cut that send off mid-upload.
it('leaves the page alone when signal comes back', () => {
  const reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
  onTestFinished(() => {
    vi.unstubAllGlobals()
  })

  render(<AppServiceWorker />)
  window.dispatchEvent(new Event('online'))

  expect(reload).not.toHaveBeenCalled()
})
