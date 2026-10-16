import { describe, expect, it } from 'vitest'
import { sizePanelAskFor } from './sizePanelAsk.tool'

const DISTRICT = 50_000

describe('sizePanelAskFor', () => {
  it('asks the fresh sample alone with nobody on the panel', () => {
    expect(sizePanelAskFor({ canReach: DISTRICT, panelCanAsk: 0 }, 96)).toEqual(
      {
        answersNeeded: 96,
        expectedAnswers: 96,
        reachesAnswersNeeded: true,
        panelSampleSize: undefined,
        freshSampleSize: 3200,
        sampleSize: 3200,
        targetResponses: 96,
        assumedReplyRate: 0.03,
        panelReplyRate: 0.4,
        freshReplyRate: 0.03,
        cost: 112,
      },
    )
  })

  it('makes up what 50 members cannot give with fresh residents', () => {
    expect(
      sizePanelAskFor({ canReach: DISTRICT, panelCanAsk: 50 }, 96),
    ).toMatchObject({
      panelSampleSize: 50,
      freshSampleSize: 2534,
      sampleSize: 2584,
      expectedAnswers: 96,
      reachesAnswersNeeded: true,
      targetResponses: 96,
    })
  })

  it('keeps inviting as many residents as members once 240 can answer', () => {
    expect(
      sizePanelAskFor({ canReach: DISTRICT, panelCanAsk: 240 }, 96),
    ).toMatchObject({
      panelSampleSize: 240,
      freshSampleSize: 240,
      sampleSize: 480,
      expectedAnswers: 103,
      targetResponses: 96,
    })
  })

  it('rests the members of a 400-person panel past the answers needed', () => {
    expect(
      sizePanelAskFor({ canReach: DISTRICT, panelCanAsk: 400 }, 96),
    ).toMatchObject({ panelSampleSize: 240, freshSampleSize: 240 })
  })

  it('says when a small district cannot reach the answers needed', () => {
    expect(
      sizePanelAskFor({ canReach: 600, panelCanAsk: 20 }, 92),
    ).toMatchObject({
      panelSampleSize: 20,
      freshSampleSize: 580,
      reachesAnswersNeeded: false,
      targetResponses: 25,
    })
  })

  it('refuses a send that would invite nobody new', () => {
    expect(
      sizePanelAskFor({ canReach: 30, panelCanAsk: 30 }, 96),
    ).toHaveProperty('error')
  })
})
