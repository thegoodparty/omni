import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'

vi.mock('gpApi/clientFetch', () => ({
  clientFetch: vi.fn(),
}))

import { clientFetch } from 'gpApi/clientFetch'
import { Campaign } from 'helpers/types'
import RecordCount from './RecordCount'

const mockClientFetch = vi.mocked(clientFetch)

const campaign = {} as Campaign

beforeEach(() => {
  vi.clearAllMocks()
})

describe('<RecordCount>', () => {
  it('renders the formatted count on success', async () => {
    mockClientFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      data: 1234,
    } as never)

    render(
      <RecordCount
        type="text"
        isCustom={false}
        campaign={campaign}
        index={0}
      />,
    )

    expect(await screen.findByText('1,234')).toBeInTheDocument()
  })

  it.each(['VOTER_DATA_UNAVAILABLE', 'MISSING_L2_DISTRICT_DATA'])(
    'shows the district-data message for the %s error code without retrying',
    async (errorCode) => {
      mockClientFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        data: { errorCode, message: 'technical server message' },
      } as never)

      render(
        <RecordCount
          type="text"
          isCustom={false}
          campaign={campaign}
          index={0}
        />,
      )

      expect(
        await screen.findByText('Voter data not available for your district'),
      ).toBeInTheDocument()
      expect(
        screen.getByText(/Please contact\s+support at help@goodparty\.org/),
      ).toBeInTheDocument()
      expect(
        screen.queryByText('technical server message'),
      ).not.toBeInTheDocument()
      expect(mockClientFetch).toHaveBeenCalledTimes(1)
    },
  )

  it('shows the generic error after retries for a server error', async () => {
    mockClientFetch.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      data: {},
    } as never)

    render(
      <RecordCount
        type="text"
        isCustom={false}
        campaign={campaign}
        index={0}
      />,
    )

    expect(
      await screen.findByText('Error counting records'),
    ).toBeInTheDocument()
    expect(mockClientFetch).toHaveBeenCalledTimes(3)
  })
})
