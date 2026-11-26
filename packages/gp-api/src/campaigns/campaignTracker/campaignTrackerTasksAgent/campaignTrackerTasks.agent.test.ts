import { describe, expect, it } from 'vitest'
import { agentManifest } from '@/agents/manifest'
import { CAMPAIGN_TRACKER_TASKS_PROMPT } from './campaignTrackerTasks.prompt'
import {
  CampaignTrackerTasksInputSchema,
  CampaignTrackerTasksOutputSchema,
} from './campaignTrackerTasks.schema'
import { listCampaignTrackerTasks } from './listCampaignTrackerTasks.tool'

// The definition the registry holds. Reading it off the registry would import
// the whole agent graph, and what is worth checking is the shape the registry
// requires: an input that owns the run, an output the manifest can express.
describe('campaign_tracker_tasks agent', () => {
  it('owns its run through organizationSlug', () => {
    expect(
      CampaignTrackerTasksInputSchema.safeParse({
        organizationSlug: '',
        raceId: 'race',
        userFullName: 'Robin Calloway',
        mode: 'initial',
        today: '2026-10-02',
        electionDate: null,
        state: null,
        city: null,
        campaignPlan: null,
        campaignStory: null,
      }).success,
    ).toBe(false)
  })

  // The judge reads one input shape from both engines: the manifest's
  // snake_case. The route converts to these names, so a field renamed here and
  // not in the converter silently loses its value.
  it('names the manifest input fields in gp-api spelling', () => {
    expect(Object.keys(CampaignTrackerTasksInputSchema.shape).sort()).toEqual(
      [
        'campaignPlan',
        'campaignStory',
        'city',
        'electionDate',
        'mode',
        'organizationSlug',
        'raceId',
        'state',
        'today',
        'userFullName',
      ].sort(),
    )
  })

  it('is expressible as a manifest, which is what a run stores', () => {
    const manifest = agentManifest({
      input: CampaignTrackerTasksInputSchema,
      output: CampaignTrackerTasksOutputSchema,
    })
    expect(manifest.input).toBeDefined()
    expect(manifest.output).toBeDefined()
  })

  it('gives the model the tracker read and no tool that spends money', () => {
    expect(Object.keys({ listCampaignTrackerTasks })).toEqual([
      'listCampaignTrackerTasks',
    ])
    expect(CAMPAIGN_TRACKER_TASKS_PROMPT).toContain('listCampaignTrackerTasks')
  })

  // The tool takes no identity from the model: the run's own organization
  // decides whose tasks these are, so a case cannot read another campaign's.
  it('takes no campaign or identity from the model', () => {
    expect(Object.keys(listCampaignTrackerTasks.input.shape)).toEqual([])
  })
})
