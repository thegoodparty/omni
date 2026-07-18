import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { router } from 'helpers/test-utils/router-mocking'
import NewOrdinanceForm from './NewOrdinanceForm'

const mocks = vi.hoisted(() => ({ createOrdinance: vi.fn() }))

vi.mock('../data/ordinances-api', () => ({
  createOrdinance: mocks.createOrdinance,
}))

const goalField = () => screen.getByPlaceholderText(/describe the change/i)
const startButton = () =>
  screen.getByRole('button', { name: /start guided flow/i })

describe('NewOrdinanceForm', () => {
  beforeEach(() => {
    mocks.createOrdinance.mockReset()
    router.push?.mockReset?.()
  })

  it('disables Start until an accomplishment is entered', () => {
    render(<NewOrdinanceForm />)

    expect(startButton()).toBeDisabled()

    fireEvent.change(goalField(), { target: { value: 'Limit noise' } })
    expect(startButton()).toBeEnabled()
  })

  it('creates the ordinance with the link and enters the guided flow', async () => {
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
    expect(router.push).toHaveBeenCalledWith(
      '/dashboard/ordinances/solve/late-night-noise/clarify',
    )
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
