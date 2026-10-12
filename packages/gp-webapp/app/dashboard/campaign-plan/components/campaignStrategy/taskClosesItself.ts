import {
  CAMPAIGN_STORY_CATEGORY,
  CAMPAIGN_TASK_CATALOG,
} from '@goodparty_org/contracts'

const CAMPAIGN_STORY_TASK_TITLES = new Set(
  CAMPAIGN_TASK_CATALOG.filter(
    (task) => task.category === CAMPAIGN_STORY_CATEGORY,
  ).map((task) => task.title),
)

// Whether a task closes itself however its work gets done, so it needs no
// manual "Mark done". Only the story task does: the server ticks it whenever
// the story is finished, from any surface. Outreach closes itself only when
// started from the task's own button, so a send made from the hub or work done
// offline still needs the candidate to mark it done.
export const taskClosesItself = (title: string): boolean =>
  CAMPAIGN_STORY_TASK_TITLES.has(title)
