import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import type { TrackerTasksResult } from './useTrackerTasks'
import CampaignStrategySection from './CampaignStrategySection'

const mockTasks = vi.fn<() => TrackerTasksResult>()
const mockToggle = vi.fn()
const mockGenerate = vi.fn()
let mockIsGenerating = false
let mockIsProd = false
// Keep the real isVoterContactFlowType; stub only the data + mutation hooks.
vi.mock('./useTrackerTasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useTrackerTasks')>()),
  useTrackerTasks: () => mockTasks(),
  useToggleTrackerTaskComplete: () => ({
    mutate: mockToggle,
    isPending: false,
  }),
  useGenerateTrackerTasks: () => ({
    generate: mockGenerate,
    isGenerating: mockIsGenerating,
  }),
}))
vi.mock('appEnv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('appEnv')>()),
  get IS_PROD() {
    return mockIsProd
  },
}))
vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ details: {}, electionDate: null }],
}))
// Stub the count modal to a submit button, mirroring the manager test.
vi.mock('../../../components/tasks/CountModal', () => ({
  default: ({
    flowType,
    onSubmit,
  }: {
    flowType: string
    onSubmit: (count: number) => void
  }) => (
    <div>
      <span>count-modal:{flowType}</span>
      <button type="button" onClick={() => onSubmit(7)}>
        submit-count
      </button>
    </div>
  ),
}))

const task = (over: Partial<CampaignTrackerTask>): CampaignTrackerTask => ({
  id: 'task-1',
  title: 'A task',
  description: '',
  cta: null,
  link: null,
  flowType: null,
  week: 2,
  // Far future so its phase is the current ("active") one and opens by default.
  date: '2099-11-03T00:00:00.000Z',
  completed: false,
  phase: 'launch',
  proRequired: false,
  isDefaultTask: false,
  ...over,
})

const settled = (tasks: CampaignTrackerTask[]): TrackerTasksResult => ({
  tasks,
  isPending: false,
  isError: false,
  isGeneratingDynamic: false,
})

beforeEach(() => {
  mockToggle.mockClear()
  mockGenerate.mockClear()
  mockIsGenerating = false
  mockIsProd = false
})

describe('CampaignStrategySection — completing tasks', () => {
  it('records a voter-contact count when completing an outreach task', async () => {
    mockTasks.mockReturnValue(
      settled([task({ id: 't1', title: 'Greet voters', flowType: 'events' })]),
    )
    const user = userEvent.setup()
    render(<CampaignStrategySection />)

    await user.click(screen.getByRole('button', { name: 'Mark task complete' }))
    expect(mockToggle).not.toHaveBeenCalled()
    expect(screen.getByText('count-modal:events')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'submit-count' }))
    expect(mockToggle).toHaveBeenCalledWith({
      id: 't1',
      completed: true,
      type: 'events',
      quantity: 7,
    })
  })

  it('completes a non-outreach task directly, without a count', async () => {
    mockTasks.mockReturnValue(
      settled([
        task({ id: 't2', title: 'Get Meta verified', flowType: 'awareness' }),
      ]),
    )
    const user = userEvent.setup()
    render(<CampaignStrategySection />)

    await user.click(screen.getByRole('button', { name: 'Mark task complete' }))
    expect(mockToggle).toHaveBeenCalledWith({ id: 't2', completed: true })
    expect(screen.queryByText(/count-modal/)).not.toBeInTheDocument()
  })
})

describe('CampaignStrategySection — manual generation override', () => {
  it('hides the Generate tasks button in prod', () => {
    mockIsProd = true
    mockTasks.mockReturnValue(settled([task({ id: 't1' })]))
    render(<CampaignStrategySection />)
    expect(
      screen.queryByRole('button', { name: 'Generate tasks' }),
    ).not.toBeInTheDocument()
  })

  it('dispatches a generation when clicked in non-prod', async () => {
    mockTasks.mockReturnValue(settled([task({ id: 't1' })]))
    const user = userEvent.setup()
    render(<CampaignStrategySection />)
    await user.click(screen.getByRole('button', { name: 'Generate tasks' }))
    expect(mockGenerate).toHaveBeenCalledTimes(1)
  })

  it('shows the generating banner while a run is in flight', () => {
    mockIsGenerating = true
    mockTasks.mockReturnValue(settled([task({ id: 't1' })]))
    render(<CampaignStrategySection />)
    expect(screen.getByText(/Finding local events/)).toBeInTheDocument()
  })
})
