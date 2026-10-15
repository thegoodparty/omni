'use client'

import { useEffect, useState } from 'react'
import { z } from 'zod'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import { useSnackbar } from 'helpers/useSnackbar'

// Tasks land in the background: the first personalized batch a few minutes
// after onboarding, then a new one every week. Rather than a spinner to wait
// on, the plan just grows, and the candidate is told what was added.
//
// Kept in the browser, per campaign: the tasks this browser already knew
// about, and the ones added since that the plan hasn't shown yet. The first
// read of a campaign seeds silently, so nobody is told everything is new.
const KNOWN_KEY = (campaignId: number) => `tracker-known-tasks:${campaignId}`
const UNSEEN_KEY = (campaignId: number) => `tracker-unseen-tasks:${campaignId}`

const readIds = (key: string): string[] | null => {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return null
    const parsed = z.array(z.string()).safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const writeIds = (key: string, ids: string[]): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids))
  } catch {
    // Storage disabled: tasks still appear, just without the notice.
  }
}

// "Added to your plan: Attend the Oct 12 town hall", or a count with the
// first two named.
export const newTasksMessage = (
  added: Pick<CampaignTrackerTask, 'title'>[],
): { message: string; description?: string } => {
  const [first, second] = added
  if (added.length === 1 && first) {
    return { message: `Added to your plan: ${first.title}` }
  }
  const named = [first, second]
    .filter((task) => task !== undefined)
    .map((task) => task.title)
    .join(', ')
  const more = added.length - 2
  return {
    message: `${added.length} tasks added to your plan`,
    description: more > 0 ? `${named}, and ${more} more` : named,
  }
}

/**
 * Announces tasks that arrived since this browser last looked, and returns
 * the ones the plan hasn't shown yet so it can mark them. `onSeePlan` puts a
 * button on the notice; the plan itself passes none. `markSeen` clears the
 * marks when the plan is left, so they last one visit.
 */
export const useNewTrackerTasks = (
  tasks: CampaignTrackerTask[],
  campaignId: number | undefined,
  {
    onSeePlan,
    markSeen = false,
  }: { onSeePlan?: () => void; markSeen?: boolean } = {},
): Set<string> => {
  const { successSnackbar } = useSnackbar()
  const [unseen, setUnseen] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!campaignId || tasks.length === 0) return
    const known = readIds(KNOWN_KEY(campaignId))
    const ids = tasks.map((task) => task.id)
    writeIds(KNOWN_KEY(campaignId), [...new Set([...(known ?? []), ...ids])])
    const pending = readIds(UNSEEN_KEY(campaignId)) ?? []
    if (known === null) {
      setUnseen(new Set(pending))
      return
    }
    const added = tasks.filter(
      (task) => !known.includes(task.id) && !task.completed,
    )
    const next = [...new Set([...pending, ...added.map((task) => task.id)])]
    writeIds(UNSEEN_KEY(campaignId), next)
    setUnseen(new Set(next))
    if (added.length === 0) return
    successSnackbar(newTasksMessage(added).message, {
      description: newTasksMessage(added).description,
      autoHideDuration: 8000,
      action: onSeePlan
        ? { label: 'See in plan', onClick: onSeePlan }
        : undefined,
    })
    // Only a change in the tasks themselves is news.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, campaignId])

  useEffect(() => {
    if (!markSeen || !campaignId) return
    return () => writeIds(UNSEEN_KEY(campaignId), [])
  }, [markSeen, campaignId])

  return unseen
}
