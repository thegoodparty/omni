import { describe, expect, it } from 'vitest'
import {
  buildSizeOutreachSampleTool,
  sizeOutreachSample,
} from './sizeOutreachSample.tool'

describe('sizeOutreachSample', () => {
  it('sizes a big audience the way polls do and prices both options', () => {
    expect(sizeOutreachSample({ audience: 50_000 })).toEqual({
      targetReplies: 83,
      replyRate: 0.03,
      notYetAsked: 50_000,
      sampleSize: 2_767,
      wholeAudience: false,
      sampleCost: 96.85,
      wholeAudienceCost: 1_750,
    })
  })

  it("uses the office's own reply rate", () => {
    expect(
      sizeOutreachSample({ audience: 50_000, replyRate: 0.05 }),
    ).toMatchObject({ sampleSize: 1_660 })
  })

  it('sizes a widen for the replies still missing', () => {
    expect(
      sizeOutreachSample({ audience: 50_000, repliesAlready: 50 }),
    ).toMatchObject({ sampleSize: 1_100 })
  })

  it('says a small audience goes to everyone', () => {
    expect(sizeOutreachSample({ audience: 1_200 })).toMatchObject({
      sampleSize: 1_200,
      wholeAudience: true,
      sampleCost: 42,
      wholeAudienceCost: 42,
    })
  })

  it('sizes a widen against the people not yet asked', () => {
    expect(
      sizeOutreachSample({
        audience: 500,
        alreadyAsked: 300,
        repliesAlready: 20,
      }),
    ).toMatchObject({ notYetAsked: 200, sampleSize: 200, wholeAudience: true })
  })

  it('refuses a widen when everyone was already asked', () => {
    expect(
      sizeOutreachSample({ audience: 500, alreadyAsked: 500 }),
    ).toMatchObject({ error: expect.stringContaining('already been asked') })
  })

  it('refuses a widen once the replies are in', () => {
    expect(
      sizeOutreachSample({ audience: 50_000, repliesAlready: 83 }),
    ).toMatchObject({ error: expect.stringContaining('already in') })
  })

  it('refuses an audience that counted nobody', () => {
    const parsed = buildSizeOutreachSampleTool().inputSchema.safeParse({
      audience: 0,
    })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toContain('counted nobody')
  })
})
