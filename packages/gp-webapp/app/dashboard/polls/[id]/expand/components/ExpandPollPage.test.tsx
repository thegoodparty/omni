import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import ExpandPollPage from './ExpandPollPage'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { PollProvider } from '../../../shared/hooks/PollProvider'
import { Poll, PollStatus } from '../../../shared/poll-types'

// The audience query now reads the org's resolved district (Serve has no Pro gate,
// so that predicate is its only protection). Mutable so the unavailable branch is
// actually exercised, not just the happy path.
const mockOrg = vi.hoisted(() => ({
  current: {
    slug: 'eo-1',
    positionName: 'City Council',
    district: { id: 'd1', l2Type: 'City', l2Name: 'Austin' },
  } as unknown,
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => mockOrg.current,
}))

beforeEach(() => {
  mockOrg.current = {
    slug: 'eo-1',
    positionName: 'City Council',
    district: { id: 'd1', l2Type: 'City', l2Name: 'Austin' },
  }
})

const poll: Poll = {
  id: '1234',
  name: 'Test Poll',
  status: PollStatus.SCHEDULED,
  messageContent: '',
  scheduledDate: new Date().toISOString(),
  estimatedCompletionDate: new Date().toISOString(),
  audienceSize: 500,
  responseCount: 50,
  lowConfidence: true,
}

it('shows the audience selection form', async () => {
  api.mock('GET /v1/contacts/stats', {
    status: 200,
    data: {
      districtId: '1234',
      totalConstituents: 30000,
      totalConstituentsWithCellPhone: 9000,
      computedAt: new Date().toISOString(),
      buckets: {
        age: [],
        homeowner: [],
        education: [],
        presenceOfChildren: [],
        estimatedIncomeRange: [],
      },
    },
  })

  render(
    <PollProvider poll={poll}>
      <ExpandPollPage scheduledDate={undefined} count={undefined} />
    </PollProvider>,
  )

  await screen.findByText('Recommended')

  await screen.findByText('2,125 constituents (25%)')
  await screen.findByText('4,250 constituents (50%)')
  await screen.findByText('6,375 constituents (75%)')
  await screen.findByText('8,500 constituents (100%)')

  fireEvent.click(await screen.findByText('330 constituents (4%)'))

  fireEvent.click(await screen.findByText('Pick Send Date'))

  await screen.findByText('When would you like to send your text messages?')
})

// The isUnavailable early return has to be exercised at the component level, not
// just asserted on the hook: it sits ahead of the status !== 'success' spinner
// branch, and getting that order wrong is what makes a district-gated query spin
// forever instead of explaining itself.
describe('ExpandPollPage — unresolvable district', () => {
  it('explains and offers contacts instead of spinning or showing the audience form', async () => {
    const onRequest = vi.fn()
    api.mock('GET /v1/contacts/stats', () => {
      onRequest()
      return {
        status: 200,
        data: {
          districtId: '1234',
          totalConstituents: 30000,
          totalConstituentsWithCellPhone: 9000,
          computedAt: new Date().toISOString(),
          buckets: {
            age: [],
            homeowner: [],
            education: [],
            presenceOfChildren: [],
            estimatedIncomeRange: [],
          },
        },
      }
    })
    mockOrg.current = {
      slug: 'eo-1',
      positionName: 'City Council',
      district: null,
    }

    render(
      <PollProvider poll={poll}>
        <ExpandPollPage scheduledDate={undefined} count={undefined} />
      </PollProvider>,
    )

    expect(
      await screen.findByText(
        /don't have constituent data for this office yet/i,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /visit contacts/i }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Recommended')).not.toBeInTheDocument()
    expect(onRequest).not.toHaveBeenCalled()
  })
})
