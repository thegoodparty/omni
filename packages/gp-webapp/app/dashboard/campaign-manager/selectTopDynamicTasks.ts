import type { CampaignTrackerTask } from 'gpApi/api-endpoints'

// The dynamic tracker tasks the Campaign Manager surfaces: the AI-picked set
// (isDefaultTask=false), latest generation only, incomplete, in the model's
// ranked order (which the tracker materializes as date ascending). Mirrors the
// server-side selector the manager agent uses so the page and the agent agree.
// Deliberately not the weekly digest's top 3, which spans all task kinds.
const TOP_N = 3

export function selectTopDynamicTasks(
  tasks: CampaignTrackerTask[],
): CampaignTrackerTask[] {
  const dynamic = tasks.filter((t) => !t.isDefaultTask)
  if (dynamic.length === 0) return []

  const latestGen = Math.max(...dynamic.map((t) => t.week))
  return dynamic
    .filter((t) => t.week === latestGen && !t.completed)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, TOP_N)
}
