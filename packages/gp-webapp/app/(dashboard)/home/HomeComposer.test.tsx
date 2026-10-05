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
let mockNeedsFiling = true
vi.mock('./useNextThing', () => ({
  useNextThing: () => ({
    next: mockNext,
    needsFiling: mockNeedsFiling,
    eventProps: mockNext ? { trackerTaskId: mockNext.id } : null,
  }),
}))

const box = () => screen.getByRole('textbox')

beforeEach(() => {
  mockNext = ballotTask
  mockNeedsFiling = true
  mockSend.mockClear()
  vi.mocked(trackEvent).mockClear()
})

describe('HomeComposer', () => {
  it('sends a question framed as being about the next step', async () => {
    render(<HomeComposer />)

    expect(
      screen.getByText('About: Submit your Ballot Access Signatures'),
    ).toBeInTheDocument()
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

  it('sends a general question once the label is cleared', async () => {
    render(<HomeComposer />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Ask about something else' }),
    )
    await userEvent.type(box(), 'What is a filing fee?{Enter}')

    expect(mockSend).toHaveBeenCalledWith('What is a filing fee?')
    expect(trackEvent).not.toHaveBeenCalled()
    expect(box()).toHaveAttribute('placeholder', 'Hi Sarah, how can I help?')
  })

  it('fills the box from a suggestion without sending', async () => {
    render(<HomeComposer />)

    await userEvent.click(
      screen.getByRole('button', { name: 'How many signatures do I need?' }),
    )

    expect(box()).toHaveValue('How many signatures do I need?')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('keeps Shift+Enter for a new line', async () => {
    render(<HomeComposer />)

    await userEvent.type(box(), 'Line one{Shift>}{Enter}{/Shift}Line two')

    expect(box()).toHaveValue('Line one\nLine two')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('offers suggestions that fit the kind of task', () => {
    mockNext = { ...ballotTask, id: 'text', flowType: 'text' }
    mockNeedsFiling = false
    render(<HomeComposer />)

    expect(
      screen.getByRole('button', { name: 'Draft this message for me' }),
    ).toBeInTheDocument()
  })

  it('is a plain chat box when there is no next thing', () => {
    mockNext = null
    render(<HomeComposer />)

    expect(screen.queryByText(/^About:/)).not.toBeInTheDocument()
    expect(box()).toHaveAttribute('placeholder', 'Hi Sarah, how can I help?')
  })
})
