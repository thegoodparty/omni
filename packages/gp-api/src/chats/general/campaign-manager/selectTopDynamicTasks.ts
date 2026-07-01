import { compareAsc } from 'date-fns'

// The dynamic tracker tasks a candidate should see first: the AI-picked set
// (isDefaultTask=false), from the latest generation only, incomplete, in the
// model's ranked order (which the tracker materializes as date ascending). This
// is deliberately NOT the weekly digest's top 3, which spans all task kinds and
// puts the deterministic outreach sends first.
const TOP_N = 3

type DynamicTaskRow = {
  isDefaultTask: boolean | null
  week: number
  completed: boolean
  date: Date
}

export const selectTopDynamicTasks = <T extends DynamicTaskRow>(
  rows: T[],
): T[] => {
  const dynamic = rows.filter((r) => !r.isDefaultTask)
  if (dynamic.length === 0) return []

  const latestGen = Math.max(...dynamic.map((r) => r.week))
  return dynamic
    .filter((r) => r.week === latestGen && !r.completed)
    .sort((a, b) => compareAsc(a.date, b.date))
    .slice(0, TOP_N)
}
