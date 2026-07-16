import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => '/',
}))

vi.mock('gpApi/clientFetch', () => ({
  clientFetch: vi.fn(),
}))

const refreshSurvey = vi.fn()
let mockSurvey: { id: string; status: string } | null

vi.mock('@shared/hooks/useEcanvasserSurvey', () => ({
  useEcanvasserSurvey: () => [mockSurvey, refreshSurvey],
}))

import { clientFetch } from 'gpApi/clientFetch'
import EditSurvey from './EditSurvey'

const mockClientFetch = vi.mocked(clientFetch)

beforeEach(() => {
  vi.clearAllMocks()
  mockSurvey = { id: 'survey-1', status: 'Not Live' }
})

describe('<EditSurvey>', () => {
  it('navigates to the surveys list via router after a successful delete', async () => {
    mockClientFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      data: {},
    })

    render(<EditSurvey />)

    await userEvent.click(screen.getByRole('button', { name: 'More options' }))
    await userEvent.click(
      await screen.findByText('Delete door knocking script'),
    )
    await userEvent.click(
      await screen.findByRole('button', { name: 'Proceed' }),
    )

    await waitFor(() =>
      expect(mockClientFetch).toHaveBeenCalledWith(expect.anything(), {
        id: 'survey-1',
      }),
    )
    expect(push).toHaveBeenCalledWith('/dashboard/door-knocking/surveys')
    expect(refresh).toHaveBeenCalled()
  })
})
