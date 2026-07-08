import { describe, expect, it } from 'vitest'
import { selectTopDynamicTasks } from './selectTopDynamicTasks'

type Row = {
  id: string
  title: string
  isDefaultTask: boolean | null
  week: number
  completed: boolean
  date: Date
}

const task = (over: Partial<Row>): Row => ({
  id: Math.random().toString(36).slice(2),
  title: 'task',
  isDefaultTask: false,
  week: 1,
  completed: false,
  date: new Date('2026-07-01T00:00:00Z'),
  ...over,
})

describe('selectTopDynamicTasks', () => {
  it('keeps the 3 earliest incomplete dynamic tasks from the latest generation', () => {
    const rows = [
      task({ title: 'a', week: 2, date: new Date('2026-07-03T00:00:00Z') }),
      task({ title: 'b', week: 2, date: new Date('2026-07-01T00:00:00Z') }),
      task({ title: 'c', week: 2, date: new Date('2026-07-02T00:00:00Z') }),
      task({ title: 'd', week: 2, date: new Date('2026-07-04T00:00:00Z') }),
    ]

    const result = selectTopDynamicTasks(rows)

    expect(result.map((t) => t.title)).toEqual(['b', 'c', 'a'])
  })

  it('excludes static/outreach (default) rows', () => {
    const rows = [
      task({ title: 'dynamic', week: 3 }),
      task({ title: 'static', isDefaultTask: true, week: 99 }),
    ]

    const result = selectTopDynamicTasks(rows)

    expect(result.map((t) => t.title)).toEqual(['dynamic'])
  })

  it('keeps only the latest dynamic generation and ignores default-row weeks', () => {
    const rows = [
      task({ title: 'old', week: 1 }),
      task({ title: 'new', week: 2 }),
      task({ title: 'default-high-week', isDefaultTask: true, week: 50 }),
    ]

    const result = selectTopDynamicTasks(rows)

    expect(result.map((t) => t.title)).toEqual(['new'])
  })

  it('excludes completed tasks and returns fewer than 3 when that is all', () => {
    const rows = [
      task({ title: 'done', completed: true }),
      task({ title: 'todo' }),
    ]

    const result = selectTopDynamicTasks(rows)

    expect(result.map((t) => t.title)).toEqual(['todo'])
  })

  it('returns an empty array when there are no dynamic tasks', () => {
    expect(selectTopDynamicTasks([])).toEqual([])
    expect(
      selectTopDynamicTasks([task({ isDefaultTask: true, week: 5 })]),
    ).toEqual([])
  })
})
