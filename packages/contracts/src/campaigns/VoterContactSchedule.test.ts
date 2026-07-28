import { describe, expect, it } from 'vitest'
import { CAMPAIGN_TASK_CATALOG } from './CampaignTaskCatalog.data'
import { TaskTiming } from './CampaignTaskCatalog.schema'
import { VOTER_CONTACT_SCHEDULE } from './VoterContactSchedule.data'

const timingDaysBeforeElection = (timing: TaskTiming): number | null => {
  if (timing.kind === 'electionRelative') {
    return timing.unit === 'weeks' ? timing.offset * 7 : timing.offset
  }
  return timing.kind === 'electionDay' ? 0 : null
}

describe('VOTER_CONTACT_SCHEDULE', () => {
  it('covers exactly the catalog text/robocall sends', () => {
    const catalogSendIds = CAMPAIGN_TASK_CATALOG.filter(
      (t) => t.channel === 'text' || t.channel === 'robocall',
    ).map((t) => t.id)
    const scheduleIds = VOTER_CONTACT_SCHEDULE.map((s) => s.catalogId)
    expect(scheduleIds.toSorted()).toEqual(catalogSendIds.toSorted())
  })

  it('matches each catalog send timing (all surfaces show the same dates)', () => {
    for (const send of VOTER_CONTACT_SCHEDULE) {
      const task = CAMPAIGN_TASK_CATALOG.find((t) => t.id === send.catalogId)
      expect(task, send.catalogId).toBeDefined()
      expect(
        timingDaysBeforeElection(task!.timing),
        `${send.catalogId} days before election`,
      ).toBe(send.daysBeforeElection)
    }
  })

  it("matches each catalog send channel to the schedule's tactic", () => {
    for (const send of VOTER_CONTACT_SCHEDULE) {
      const task = CAMPAIGN_TASK_CATALOG.find((t) => t.id === send.catalogId)
      expect(task?.channel, send.catalogId).toBe(send.tactic.toLowerCase())
    }
  })
})
