import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { format } from 'date-fns'
import { ROBOCALL_FREE_OFFER_VARIANT } from '@goodparty_org/contracts'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import { render } from 'helpers/test-utils/render'
import type { TrackerTasksResult } from './useTrackerTasks'
import NextTaskCard from './NextTaskCard'

const {
  mockChat,
  mockFreeOffer,
  mockSmsCompliance,
  mockTasks,
  mockTasksPending,
} = vi.hoisted(() => ({
  mockTasksPending: { current: false },
  mockChat: { current: null as Record<string, unknown> | null },
  mockFreeOffer: {
    current: {
      offer: null as { eligible: true } | null,
      isLoading: false,
    },
  },
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
vi.mock('app/dashboard/shared/robocallFreeOffer/useRobocallFreeOffer', () => ({
  ROBOCALL_FREE_OFFER_QUERY_KEY: 'robocall-free-offer',
  useRobocallFreeOffer: () => mockFreeOffer.current,
}))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ id: 1, details: { electionDate: '2099-11-03' } }],
}))
vi.mock('app/dashboard/campaign-manager/CampaignManagerChatProvider', () => ({
  useCampaignManagerChat: () => mockChat.current,
}))
vi.mock('@shared/hooks/usePositionName', () => ({
  usePositionName: () => 'Mayor',
}))
vi.mock('./useTrackerTasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useTrackerTasks')>()),
  useTrackerTasks: (): TrackerTasksResult => ({
    tasks: mockTasks.current,
    isPending: mockTasksPending.current,
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
  mockChat.current = null
  mockFreeOffer.current = { offer: null, isLoading: false }
  mockTasksPending.current = false
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

const offerTask = (
  overrides: Partial<CampaignTrackerTask> = {},
): CampaignTrackerTask => ({
  id: 'free-offer',
  title:
    'Send a free promotional robocall to landline voters in selected precincts',
  description: 'Reach voters the day before Election Day.',
  cta: 'Send outreach',
  link: `/dashboard/outreach?compose=robocall&recommended=${ROBOCALL_FREE_OFFER_VARIANT}`,
  flowType: 'robocall',
  week: 1,
  date: `${format(new Date(), 'yyyy-MM-dd')}T00:00:00.000Z`,
  completed: false,
  phase: 'active',
  proRequired: true,
  isDefaultTask: false,
  ...overrides,
})

describe('NextTaskCard free robocall offer', () => {
  it('leads with the offer while the campaign has it', () => {
    mockFreeOffer.current = { offer: { eligible: true }, isLoading: false }
    mockTasks.current = [sendTask('text'), offerTask()]
    render(<NextTaskCard surface="manager" />)

    expect(
      screen.getByRole('heading', { name: offerTask().title }),
    ).toBeInTheDocument()
    expect(screen.getByText('Free offer')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Set up your free robocall' }),
    ).toHaveAttribute('href', offerTask().link)
  })

  it('offers no Mark done on the offer, beside its button or under Skip', async () => {
    mockFreeOffer.current = { offer: { eligible: true }, isLoading: false }
    mockTasks.current = [offerTask()]
    render(<NextTaskCard surface="manager" />)

    expect(screen.queryByRole('button', { name: /mark done/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(
      await screen.findByRole('menuitem', { name: 'Show in 3 days' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Mark done' })).toBeNull()
  })

  it('stops advertising the offer once it has ended', () => {
    mockTasks.current = [offerTask()]
    render(<NextTaskCard surface="manager" />)

    expect(screen.queryByText('Free offer')).toBeNull()
    expect(
      screen.queryByRole('link', { name: 'Set up your free robocall' }),
    ).toBeNull()
  })

  it('leads even when gp-api dated it tomorrow', () => {
    mockFreeOffer.current = { offer: { eligible: true }, isLoading: false }
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    mockTasks.current = [
      sendTask('text'),
      offerTask({ date: `${format(tomorrow, 'yyyy-MM-dd')}T00:00:00.000Z` }),
    ]
    render(<NextTaskCard surface="manager" />)

    expect(
      screen.getByRole('heading', { name: offerTask().title }),
    ).toBeInTheDocument()
  })

  it('steps back when the offer is put off or set aside', () => {
    mockFreeOffer.current = { offer: { eligible: true }, isLoading: false }
    const later = new Date()
    later.setDate(later.getDate() + 3)
    for (const task of [
      offerTask({
        date: `${format(later, 'yyyy-MM-dd')}T00:00:00.000Z`,
        skipReason: 'later',
      }),
      offerTask({ skipReason: 'notForMe' }),
    ]) {
      mockTasks.current = [sendTask('text'), task]
      const { unmount } = render(<NextTaskCard surface="manager" />)
      expect(
        screen.getByRole('heading', { name: 'Send an introduction text' }),
      ).toBeInTheDocument()
      unmount()
    }
  })
})

describe('NextTaskCard first paint', () => {
  it('shows no card while the offer is still loading, then the offer task', () => {
    mockFreeOffer.current = { offer: null, isLoading: true }
    mockTasks.current = [sendTask('text'), offerTask()]
    const { rerender } = render(<NextTaskCard surface="manager" />)

    expect(screen.queryByRole('heading', { level: 3 })).toBeNull()

    mockFreeOffer.current = { offer: { eligible: true }, isLoading: false }
    rerender(<NextTaskCard surface="manager" />)
    expect(
      screen.getByRole('heading', { name: offerTask().title }),
    ).toBeInTheDocument()
  })

  it('shows no card while the plan is still loading', () => {
    mockTasksPending.current = true
    mockTasks.current = [sendTask('text')]
    render(<NextTaskCard surface="manager" />)

    expect(screen.queryByRole('heading', { level: 3 })).toBeNull()
  })

  it('holds when the offer is there but its task is not, until the retry lands', async () => {
    mockFreeOffer.current = { offer: { eligible: true }, isLoading: false }
    mockTasks.current = [sendTask('text')]
    const { rerender } = render(<NextTaskCard surface="manager" />)

    expect(screen.queryByRole('heading', { level: 3 })).toBeNull()

    mockTasks.current = [sendTask('text'), offerTask()]
    rerender(<NextTaskCard surface="manager" />)
    expect(
      await screen.findByRole('heading', { name: offerTask().title }),
    ).toBeInTheDocument()
  })

  it('shows the plan task once the retry finds no offer task', async () => {
    mockFreeOffer.current = { offer: { eligible: true }, isLoading: false }
    mockTasks.current = [sendTask('text')]
    render(<NextTaskCard surface="manager" />)

    expect(
      await screen.findByRole('heading', {
        name: 'Send an introduction text',
      }),
    ).toBeInTheDocument()
  })
})

describe('NextTaskCard election result question', () => {
  const asking = () => {
    const question = {
      pending: true,
      answerWon: vi.fn(),
      saveLoss: vi.fn(async () => true),
      snooze: vi.fn(),
    }
    mockChat.current = { electionResult: question, discussTask: vi.fn() }
    return question
  }

  it('leads Home’s deck with the question, in front of the tasks', async () => {
    const question = asking()
    mockTasks.current = [sendTask('text')]
    render(<NextTaskCard surface="manager" />)

    expect(
      screen.getByRole('heading', { name: 'Did you win your race for Mayor?' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Your election was on November 3. Tell me how it went so I can help with what's next.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Send a text' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'I won' }))
    expect(question.answerWon).toHaveBeenCalled()
    await userEvent.click(
      screen.getByRole('button', { name: "Results aren't final yet" }),
    )
    expect(question.snooze).toHaveBeenCalled()
  })

  it('asks even before the plan has tasks', () => {
    asking()
    mockTasks.current = []
    render(<NextTaskCard surface="manager" />)

    expect(
      screen.getByRole('button', { name: "I didn't win" }),
    ).toBeInTheDocument()
  })

  it('is never asked on the plan', () => {
    asking()
    mockTasks.current = [sendTask('text')]
    render(<NextTaskCard surface="plan" heading="Your next step" />)

    expect(
      screen.getByRole('link', { name: 'Send a text' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'I won' })).toBeNull()
  })
})
