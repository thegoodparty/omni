import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import { render } from 'helpers/test-utils/render'
import type { TrackerTasksResult } from './useTrackerTasks'
import NextTaskCard from './NextTaskCard'

const { mockSmsCompliance, mockTasks } = vi.hoisted(() => ({
  mockSmsCompliance: {
    current: {
      smsCompliance: 'open',
      smsCutoffDate: null as string | null,
      generalElectionDate: null as string | null,
    },
  },
  mockTasks: { current: [] as CampaignTrackerTask[] },
}))

vi.mock('app/dashboard/shared/smsCutoff/useSmsCompliance', () => ({
  useSmsCompliance: () => mockSmsCompliance.current,
}))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ id: 1, details: { electionDate: '2099-11-03' } }],
}))
vi.mock('app/dashboard/campaign-manager/CampaignManagerChatProvider', () => ({
  useCampaignManagerChat: () => null,
}))
vi.mock('./useTrackerTasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useTrackerTasks')>()),
  useTrackerTasks: (): TrackerTasksResult => ({
    tasks: mockTasks.current,
    isPending: false,
    isError: false,
    isGeneratingDynamic: false,
  }),
  useToggleTrackerTaskComplete: () => ({ mutate: vi.fn(), isPending: false }),
  useSetTrackerTaskAside: () => ({ mutate: vi.fn(), isPending: false }),
}))

const todayIso = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`

const sendTask = (flowType: 'text' | 'robocall'): CampaignTrackerTask => ({
  id: `introduction-${flowType}`,
  title: flowType === 'text' ? 'Send an introduction text' : 'Robocall',
  description: 'Introduce yourself to voters.',
  cta: null,
  link: null,
  flowType,
  week: 1,
  date: todayIso,
  completed: false,
  phase: 'active',
  proRequired: true,
  isDefaultTask: true,
})

beforeEach(() => {
  window.localStorage.clear()
  mockSmsCompliance.current = {
    smsCompliance: 'open',
    smsCutoffDate: null,
    generalElectionDate: null,
  }
})

describe('NextTaskCard texting cutoff', () => {
  it('links a text task into the text flow while texting is open', () => {
    mockTasks.current = [sendTask('text')]
    render(<NextTaskCard surface="plan" heading="Your next step" />)

    expect(screen.getByRole('link', { name: 'Send a text' })).toHaveAttribute(
      'href',
      expect.stringContaining('compose=text'),
    )
  })

  it('disables a text task’s button and gives the reason on hover once texting is closed', async () => {
    mockSmsCompliance.current = {
      smsCompliance: 'closed',
      smsCutoffDate: '2026-10-15',
      generalElectionDate: '2026-11-03',
    }
    mockTasks.current = [sendTask('text')]
    render(<NextTaskCard surface="plan" heading="Your next step" />)

    expect(screen.queryByRole('link', { name: 'Send a text' })).toBeNull()
    const button = screen.getByRole('button', { name: 'Send a text' })
    expect(button).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Skip' })).toBeEnabled()

    await userEvent.hover(button.parentElement as HTMLElement)
    expect(
      (await screen.findAllByText(/deadline to get verified for texting/))
        .length,
    ).toBeGreaterThan(0)
  })

  it('leaves a robocall task alone once texting is closed', () => {
    mockSmsCompliance.current = {
      smsCompliance: 'closed',
      smsCutoffDate: '2026-10-15',
      generalElectionDate: '2026-11-03',
    }
    mockTasks.current = [sendTask('robocall')]
    render(<NextTaskCard surface="plan" heading="Your next step" />)

    expect(
      screen.getByRole('link', { name: 'Set up a robocall' }),
    ).toHaveAttribute('href', expect.stringContaining('compose=robocall'))
  })
})

describe('NextTaskCard outreach Mark done', () => {
  it('offers no Mark done on an outreach task, beside its button or under Skip', async () => {
    mockTasks.current = [sendTask('text')]
    render(<NextTaskCard surface="plan" heading="Your next step" />)

    expect(screen.queryByRole('button', { name: /mark done/i })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(
      await screen.findByRole('menuitem', { name: 'Show in 3 days' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Mark done' })).toBeNull()
  })

  it('keeps Mark done beside the button of a task with its own link', () => {
    mockTasks.current = [
      { ...sendTask('text'), flowType: null, link: 'https://example.com' },
    ]
    render(<NextTaskCard surface="plan" heading="Your next step" />)

    expect(
      screen.getByRole('button', { name: /mark done/i }),
    ).toBeInTheDocument()
  })
})
