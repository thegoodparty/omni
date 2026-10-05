import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import HomeComposer from './HomeComposer'

const mockSend = vi.fn()
vi.mock('../campaign-manager/CampaignManagerChatProvider', () => ({
  useCampaignManagerChat: () => ({ sendFromComposer: mockSend }),
}))
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ firstName: 'Sarah' }],
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

const ballotTask = {
  id: 'ballot',
  title: 'Submit your Ballot Access Signatures',
  description: '',
  flowType: null,
} as CampaignTrackerTask
let mockNext: CampaignTrackerTask | null = ballotTask
vi.mock('./useNextThing', () => ({
  useNextThing: () => ({
    next: mockNext,
    eventProps: mockNext ? { trackerTaskId: mockNext.id } : null,
  }),
}))

const box = () => screen.getByRole('textbox')

beforeEach(() => {
  mockNext = ballotTask
  mockSend.mockClear()
  vi.mocked(trackEvent).mockClear()
})

describe('HomeComposer', () => {
  it('sends a question framed as being about the next step', async () => {
    render(<HomeComposer />)

    expect(box()).toHaveAttribute('placeholder', 'Ask anything about this step')
    await userEvent.type(box(), 'Can I collect signatures online?')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(mockSend).toHaveBeenCalledWith(
      'About my next step, "Submit your Ballot Access Signatures": Can I collect signatures online?',
    )
    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.Dashboard.CampaignPlan.NextThingStarted,
      expect.objectContaining({ trackerTaskId: 'ballot', via: 'chat' }),
    )
    expect(box()).toHaveValue('')
  })

  it('sends on Enter and keeps Shift+Enter for a new line', async () => {
    render(<HomeComposer />)

    await userEvent.type(box(), 'Line one{Shift>}{Enter}{/Shift}Line two')
    expect(mockSend).not.toHaveBeenCalled()

    await userEvent.type(box(), '{Enter}')
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('is a plain chat box when there is no next thing', async () => {
    mockNext = null
    render(<HomeComposer />)

    expect(box()).toHaveAttribute('placeholder', 'Hi Sarah, how can I help?')
    await userEvent.type(box(), 'What is a filing fee?{Enter}')
    expect(mockSend).toHaveBeenCalledWith('What is a filing fee?')
    expect(trackEvent).not.toHaveBeenCalled()
  })
})
