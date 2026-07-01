import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import { selectTopDynamicTasks } from './selectTopDynamicTasks'

const task = (over: Partial<CampaignTrackerTask>): CampaignTrackerTask => ({
  id: Math.random().toString(36).slice(2),
  title: 'task',
  description: '',
  cta: null,
  link: null,
  flowType: null,
  week: 1,
  date: '2026-07-01T00:00:00.000Z',
  completed: false,
  phase: null,
  proRequired: null,
  isDefaultTask: false,
  ...over,
})

describe('selectTopDynamicTasks (client)', () => {
  it('keeps the 3 earliest incomplete dynamic tasks from the latest generation', () => {
    const tasks = [
      task({ title: 'a', week: 2, date: '2026-07-03T00:00:00.000Z' }),
      task({ title: 'b', week: 2, date: '2026-07-01T00:00:00.000Z' }),
      task({ title: 'c', week: 2, date: '2026-07-02T00:00:00.000Z' }),
      task({ title: 'd', week: 2, date: '2026-07-04T00:00:00.000Z' }),
    ]
    expect(selectTopDynamicTasks(tasks).map((t) => t.title)).toEqual([
      'b',
      'c',
      'a',
    ])
  })

  it('excludes default rows and older generations', () => {
    const tasks = [
      task({ title: 'old', week: 1 }),
      task({ title: 'new', week: 2 }),
      task({ title: 'static', isDefaultTask: true, week: 99 }),
    ]
    expect(selectTopDynamicTasks(tasks).map((t) => t.title)).toEqual(['new'])
  })

  it('excludes completed tasks and returns [] when there are no dynamic tasks', () => {
    expect(selectTopDynamicTasks([])).toEqual([])
    expect(
      selectTopDynamicTasks([task({ isDefaultTask: true, week: 5 })]),
    ).toEqual([])
    expect(
      selectTopDynamicTasks([task({ title: 'done', completed: true })]),
    ).toEqual([])
  })
})
