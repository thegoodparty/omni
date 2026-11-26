import { describe, expect, it } from 'vitest'
import {
  CampaignTrackerTasksInputSchema,
  CampaignTrackerTasksOutputSchema,
} from './campaignTrackerTasks.schema'

// The dispatcher's params (services/campaignTrackerTasks.service.ts
// `dispatchGeneration`), in gp-api's names, with the run's owner added.
const dispatchInput = {
  organizationSlug: 'campaign-org',
  raceId: 'brhash-1',
  userFullName: 'Robin Calloway',
  mode: 'weekly',
  today: '2026-10-02',
  electionDate: '2026-11-03',
  state: 'NC',
  city: 'Asheville',
  campaignPlan: 'Opportunities:\n- Three seats, top three win.',
  campaignStory: 'Why I am running: housing.',
}

describe('campaign_tracker_tasks schemas', () => {
  it('accepts what the dispatcher sends, nulls included', () => {
    expect(CampaignTrackerTasksInputSchema.parse(dispatchInput)).toEqual(
      dispatchInput,
    )
    expect(
      CampaignTrackerTasksInputSchema.parse({
        ...dispatchInput,
        electionDate: null,
        state: null,
        city: null,
        campaignPlan: null,
        campaignStory: null,
      }),
    ).toMatchObject({ city: null, campaignStory: null })
  })

  // `details.electionDate` is free-form: `updateCampaign.schema.ts` accepts any
  // string, and older rows hold a `toISOString()` value or an empty string. The
  // PMF Engine's manifest declares a bare string, so a date-shaped check here
  // would drop those campaigns on this engine alone.
  it.each(['2026-11-03T00:00:00.000Z', '', '2026-11-03'])(
    'accepts the election date %j the PMF Engine accepted',
    (electionDate) => {
      expect(
        CampaignTrackerTasksInputSchema.parse({
          ...dispatchInput,
          electionDate,
        }).electionDate,
      ).toBe(electionDate)
    },
  )

  it('refuses a run with no organization, and a mode outside the two', () => {
    expect(() =>
      CampaignTrackerTasksInputSchema.parse({
        ...dispatchInput,
        organizationSlug: '',
      }),
    ).toThrow()
    expect(() =>
      CampaignTrackerTasksInputSchema.parse({
        ...dispatchInput,
        mode: 'monthly',
      }),
    ).toThrow()
  })

  // The catalog attachment excludes the deterministic text/robocall sends and
  // the persist drops any it still gets; the output schema is the same
  // contract, so the artifact's own shape stays open but its phases do not.
  it('holds the artifact to the manifest output schema', () => {
    const artifact = {
      generated_at: '2026-10-02T15:00:00Z',
      tasks: [
        {
          kind: 'task',
          catalog_id: 'get-ein',
          title: 'Get your EIN',
          description: 'Apply for your federal tax ID.',
          phase: 'preLaunch',
          channel: 'general',
          date: null,
          address: null,
          url: null,
        },
      ],
    }
    expect(CampaignTrackerTasksOutputSchema.parse(artifact)).toEqual(artifact)
    expect(() =>
      CampaignTrackerTasksOutputSchema.parse({
        ...artifact,
        tasks: [{ ...artifact.tasks[0], phase: 'persuasion' }],
      }),
    ).toThrow()
  })
})
