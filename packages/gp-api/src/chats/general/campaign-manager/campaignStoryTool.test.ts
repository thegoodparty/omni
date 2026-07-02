import { ForbiddenException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { buildCampaignStoryTool } from './campaignStoryTool'
import {
  CampaignStoryIntakeService,
  StoryState,
} from './campaignStoryIntake.service'

const STORY: StoryState = {
  why: null,
  background: null,
  positions: [],
  complete: false,
  missing: ['why', 'background', 'positions'],
}

const buildIntake = (
  over: Partial<CampaignStoryIntakeService> = {},
): CampaignStoryIntakeService =>
  ({
    read: vi.fn(() => Promise.resolve(STORY)),
    elaborate: vi.fn(() => Promise.resolve({ rewrite: 'polished text' })),
    saveWhy: vi.fn(() => Promise.resolve()),
    saveBackground: vi.fn(() => Promise.resolve()),
    savePositions: vi.fn(() => Promise.resolve()),
    generate: vi.fn(() => Promise.resolve({ status: 'generating' })),
    ...over,
  }) as unknown as CampaignStoryIntakeService

const CAMPAIGN_ID = 42
const CANDIDATE = 'Renee Diaz'

const build = (intake: CampaignStoryIntakeService) =>
  buildCampaignStoryTool({
    intake,
    campaignId: CAMPAIGN_ID,
    candidateName: CANDIDATE,
  })

describe('buildCampaignStoryTool', () => {
  it('read returns the current story state', async () => {
    const intake = buildIntake()
    const result = await build(intake).execute({ action: 'read' })
    expect(result).toEqual({ story: STORY })
    expect(intake.read).toHaveBeenCalledWith(CAMPAIGN_ID)
  })

  it('elaborate passes the field, text, and server-bound candidate name', async () => {
    const intake = buildIntake()
    const result = await build(intake).execute({
      action: 'elaborate',
      field: 'why',
      text: 'i care about my community',
    })
    expect(result).toEqual({ rewrite: 'polished text' })
    expect(intake.elaborate).toHaveBeenCalledWith(
      CAMPAIGN_ID,
      { field: 'why', text: 'i care about my community' },
      CANDIDATE,
    )
  })

  it('elaborate rejects field=positions with an error, never calling the service', async () => {
    const intake = buildIntake()
    const result = await build(intake).execute({
      action: 'elaborate',
      field: 'positions',
      text: 'x',
    })
    expect(result).toHaveProperty('error')
    expect(intake.elaborate).not.toHaveBeenCalled()
  })

  it('elaborate turns the rewrite-limit ForbiddenException into an error object', async () => {
    const intake = buildIntake({
      elaborate: vi.fn(() => Promise.reject(new ForbiddenException())),
    })
    const result = await build(intake).execute({
      action: 'elaborate',
      field: 'background',
      text: 'x',
    })
    expect(result).toEqual({
      error: 'AI rewrite limit reached for this campaign.',
    })
  })

  it('save why persists the bio and reports saved: why', async () => {
    const intake = buildIntake()
    const result = await build(intake).execute({
      action: 'save',
      field: 'why',
      text: 'my confirmed why',
    })
    expect(intake.saveWhy).toHaveBeenCalledWith(CAMPAIGN_ID, 'my confirmed why')
    expect(result).toEqual({ saved: 'why' })
  })

  it('save background persists the story field and reports saved: background', async () => {
    const intake = buildIntake()
    const result = await build(intake).execute({
      action: 'save',
      field: 'background',
      text: 'my background',
    })
    expect(intake.saveBackground).toHaveBeenCalledWith(
      CAMPAIGN_ID,
      'my background',
    )
    expect(result).toEqual({ saved: 'background' })
  })

  it('save positions persists the array and reports saved: positions', async () => {
    const intake = buildIntake()
    const positions = [{ title: 'Schools', description: 'Fund them' }]
    const result = await build(intake).execute({
      action: 'save',
      field: 'positions',
      positions,
    })
    expect(intake.savePositions).toHaveBeenCalledWith(CAMPAIGN_ID, positions)
    expect(result).toEqual({ saved: 'positions' })
  })

  it('guards missing save inputs per field', async () => {
    const intake = buildIntake()
    const tool = build(intake)
    expect(await tool.execute({ action: 'save', field: 'why' })).toHaveProperty(
      'error',
    )
    expect(
      await tool.execute({ action: 'save', field: 'positions', positions: [] }),
    ).toHaveProperty('error')
    expect(intake.saveWhy).not.toHaveBeenCalled()
    expect(intake.savePositions).not.toHaveBeenCalled()
  })

  it('generate returns the strategy status under generation', async () => {
    const intake = buildIntake()
    const result = await build(intake).execute({ action: 'generate' })
    expect(result).toEqual({ generation: { status: 'generating' } })
    expect(intake.generate).toHaveBeenCalledWith(CAMPAIGN_ID)
  })
})
