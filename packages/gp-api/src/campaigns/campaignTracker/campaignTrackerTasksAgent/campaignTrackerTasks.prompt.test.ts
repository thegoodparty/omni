import { CAMPAIGN_TASK_CATALOG } from '@goodparty_org/contracts'
import { describe, expect, it } from 'vitest'
import { CAMPAIGN_TRACKER_TASKS_PROMPT } from './campaignTrackerTasks.prompt'

// The menu the model copies from. It has to be the same filtered set the PMF
// Engine ships as the experiment attachment
// (scripts/generate-tracker-catalog.ts), or the two engines select from
// different catalogs.
const menu = CAMPAIGN_TASK_CATALOG.filter(
  (task) =>
    task.type === 'dynamic' &&
    task.channel !== 'text' &&
    task.channel !== 'robocall',
)

describe('campaign_tracker_tasks prompt', () => {
  it('carries every dynamic task and no deterministic outreach send', () => {
    const listed = [
      ...CAMPAIGN_TRACKER_TASKS_PROMPT.matchAll(/^- `([^`]+)` — /gm),
    ]
      .map((match) => match[1])
      .sort()
    expect(listed).toEqual(menu.map((task) => task.id).sort())
    expect(listed.length).toBeGreaterThan(0)
    const excluded = CAMPAIGN_TASK_CATALOG.filter(
      (task) => task.channel === 'text' || task.channel === 'robocall',
    )
    for (const task of excluded) {
      expect(listed).not.toContain(task.id)
    }
  })

  it('names the tool that replaces the tracker-tasks MCP read', () => {
    expect(CAMPAIGN_TRACKER_TASKS_PROMPT).toContain('listCampaignTrackerTasks')
    expect(CAMPAIGN_TRACKER_TASKS_PROMPT).toContain('submitOutput')
    expect(CAMPAIGN_TRACKER_TASKS_PROMPT).not.toContain('pmf_runtime')
    expect(CAMPAIGN_TRACKER_TASKS_PROMPT).not.toContain('/workspace')
  })

  // The judge reads phase off the catalog label per item, and the 30-day rule
  // reads as licence to relabel persuasion work as gotv unless the prompt says
  // plainly that it only reorders. Losing either half fails the phase-gate case.
  it('says phase and channel are copied and the 30-day rule only reorders', () => {
    expect(CAMPAIGN_TRACKER_TASKS_PROMPT).toContain(
      'copied from the menu entry, verbatim',
    )
    expect(CAMPAIGN_TRACKER_TASKS_PROMPT).toContain('ordering only')
    expect(CAMPAIGN_TRACKER_TASKS_PROMPT).toContain(
      'door knocking and phone banking are',
    )
  })

  // Two loss modes the local judge found: an event dated after the election,
  // and a weekly list whose tasks all came back undated while the server's
  // week was usable. Both checks are cheap prompt text, not code.
  it('checks event dates as ISO strings and dates the week', () => {
    expect(CAMPAIGN_TRACKER_TASKS_PROMPT).toContain('`today <= date`')
    expect(CAMPAIGN_TRACKER_TASKS_PROMPT).toContain('`date <= electionDate`')
    expect(CAMPAIGN_TRACKER_TASKS_PROMPT).toContain('Monday-to-Sunday week')
    expect(CAMPAIGN_TRACKER_TASKS_PROMPT).toContain('on or after `today`')
  })
})
