import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, fireEvent, waitFor, act } from '@testing-library/react'
import { router } from 'helpers/test-utils/router-mocking'
import NewOrdinanceForm from './NewOrdinanceForm'

const mocks = vi.hoisted(() => ({ createOrdinance: vi.fn() }))

vi.mock('../data/ordinances-api', () => ({
  createOrdinance: mocks.createOrdinance,
}))

// Control the intro type-out animation via the reduced-motion query: reduce
// skips it so the form is present immediately.
const mockMatchMedia = (reduce: boolean): void => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }))
}

const goalField = () => screen.getByPlaceholderText(/describe the change/i)
const startButton = () =>
  screen.getByRole('button', { name: /start guided flow/i })

describe('NewOrdinanceForm', () => {
  beforeEach(() => {
    mocks.createOrdinance.mockReset()
    router.push?.mockReset?.()
    mockMatchMedia(true)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('disables Start until an accomplishment is entered', () => {
    render(<NewOrdinanceForm />)

    expect(startButton()).toBeDisabled()

    fireEvent.change(goalField(), { target: { value: 'Limit noise' } })
    expect(startButton()).toBeEnabled()
  })

  it('types the intro in, then reveals the form (motion enabled)', () => {
    mockMatchMedia(false)
    vi.useFakeTimers()

    render(<NewOrdinanceForm />)

    // The form is hidden while the intro is still typing out.
    expect(
      screen.queryByPlaceholderText(/describe the change/i),
    ).not.toBeInTheDocument()

    // Two phases: the first advance finishes the type-out (which schedules the
    // reveal on the act() boundary), the second elapses the hold that reveals
    // the fields. Both boundaries sit well clear of the reveal deadline, so the
    // outcome doesn't depend on fake-timer flush ordering.
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(
      screen.getByPlaceholderText(/describe the change/i),
    ).toBeInTheDocument()
  })

  it('sends the goal and link to createOrdinance', async () => {
    mocks.createOrdinance.mockResolvedValue({ slug: 'late-night-noise' })
    render(<NewOrdinanceForm />)

    fireEvent.change(goalField(), {
      target: { value: 'Limit late-night noise' },
    })
    fireEvent.change(screen.getByPlaceholderText('https://'), {
      target: { value: 'https://city.gov/ord/12' },
    })
    fireEvent.click(startButton())

    await waitFor(() =>
      expect(mocks.createOrdinance).toHaveBeenCalledWith({
        seedType: 'new',
        goalText: 'Limit late-night noise',
        sourceLink: 'https://city.gov/ord/12',
      }),
    )
  })

  it('navigates to the clarify step for the new slug', async () => {
    mocks.createOrdinance.mockResolvedValue({ slug: 'late-night-noise' })
    render(<NewOrdinanceForm />)

    fireEvent.change(goalField(), {
      target: { value: 'Limit late-night noise' },
    })
    fireEvent.click(startButton())

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(
        '/dashboard/ordinances/solve/late-night-noise/clarify',
      ),
    )
  })

  it('disables the form while the request is in flight', async () => {
    let resolveCreate: ((value: { slug: string }) => void) | undefined
    mocks.createOrdinance.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve
        }),
    )
    render(<NewOrdinanceForm />)

    fireEvent.change(goalField(), { target: { value: 'Do a thing' } })
    fireEvent.click(startButton())

    await waitFor(() => expect(startButton()).toBeDisabled())
    expect(goalField()).toBeDisabled()
    expect(screen.getByPlaceholderText('https://')).toBeDisabled()

    // Settle so the pending state update doesn't leak into the next test.
    resolveCreate?.({ slug: 'x' })
  })

  it('omits an empty link from the request', async () => {
    mocks.createOrdinance.mockResolvedValue({ slug: 'noise' })
    render(<NewOrdinanceForm />)

    fireEvent.change(goalField(), { target: { value: 'Do a thing' } })
    fireEvent.click(startButton())

    await waitFor(() =>
      expect(mocks.createOrdinance).toHaveBeenCalledWith({
        seedType: 'new',
        goalText: 'Do a thing',
      }),
    )
  })

  it('surfaces an error when creation fails', async () => {
    mocks.createOrdinance.mockRejectedValue(new Error('nope'))
    render(<NewOrdinanceForm />)

    fireEvent.change(goalField(), { target: { value: 'Do a thing' } })
    fireEvent.click(startButton())

    expect(
      await screen.findByText(/could not create the ordinance/i),
    ).toBeVisible()
    expect(router.push).not.toHaveBeenCalled()
  })
})
