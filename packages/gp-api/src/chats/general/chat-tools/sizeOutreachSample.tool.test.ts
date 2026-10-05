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
      sampleSize: 2_767,
      wholeAudience: false,
      sampleCost: 96.85,
      wholeAudienceCost: 1_750,
    })
  })

  it("uses the office's own reply rate", () => {
    expect(
      sizeOutreachSample({ audience: 50_000, replyRate: 0.05 }).sampleSize,
    ).toBe(1_660)
  })

  it('sizes a widen for the replies still missing', () => {
    expect(
      sizeOutreachSample({ audience: 50_000, repliesAlready: 50 }).sampleSize,
    ).toBe(1_100)
  })

  it('says a small audience goes to everyone', () => {
    const sized = sizeOutreachSample({ audience: 1_200 })
    expect(sized.sampleSize).toBe(1_200)
    expect(sized.wholeAudience).toBe(true)
    expect(sized.sampleCost).toBe(sized.wholeAudienceCost)
  })

  it('refuses an audience that counted nobody', () => {
    const parsed = buildSizeOutreachSampleTool().inputSchema.safeParse({
      audience: 0,
    })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toContain('counted nobody')
  })
})
