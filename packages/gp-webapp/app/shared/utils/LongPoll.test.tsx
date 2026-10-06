import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { LongPoll } from './LongPoll'

afterEach(() => {
  vi.restoreAllMocks()
})

// Pins the boundary race: a terminal result landing on the exact attempt
// that also exhausts `limit` must win outright. `onLimitReached` used to
// guard on `stopPolling`, a prop the caller's own `onSuccess` sets via React
// state on this same tick -- that update hasn't reached LongPoll's ref by
// the time the limit check runs, so both callbacks fired together and a
// build that legitimately resolved on its last allowed poll could still
// surface as a spurious failure.
describe('LongPoll limit-vs-terminal-result race', () => {
  it('lets a terminal result on the limit-th attempt win, without firing onLimitReached', async () => {
    let attempt = 0
    const pollingMethod = vi.fn(async () => {
      attempt += 1
      return attempt >= 3 ? 'ready' : 'building'
    })
    const onSuccess = vi.fn((result: string | void) => result === 'ready')
    const onLimitReached = vi.fn()

    render(
      <LongPoll<string>
        pollingMethod={pollingMethod}
        pollingDelay={5}
        limit={3}
        onSuccess={onSuccess}
        onLimitReached={onLimitReached}
      />,
    )

    await waitFor(() => expect(onSuccess).toHaveBeenLastCalledWith('ready'))
    // Give any wrongly-scheduled extra tick a chance to fire before the
    // negative assertion below.
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(onLimitReached).not.toHaveBeenCalled()
    expect(pollingMethod).toHaveBeenCalledTimes(3)
  })

  it('still fires onLimitReached exactly once when the limit is reached with a persistent non-terminal result', async () => {
    const pollingMethod = vi.fn(async () => 'building')
    const onSuccess = vi.fn(() => false)
    const onLimitReached = vi.fn()

    render(
      <LongPoll<string>
        pollingMethod={pollingMethod}
        pollingDelay={5}
        limit={3}
        onSuccess={onSuccess}
        onLimitReached={onLimitReached}
      />,
    )

    await waitFor(() => expect(onLimitReached).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(onLimitReached).toHaveBeenCalledTimes(1)
    expect(pollingMethod).toHaveBeenCalledTimes(3)
  })
})
