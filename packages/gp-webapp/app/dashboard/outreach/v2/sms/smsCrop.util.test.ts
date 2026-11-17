import { describe, expect, it } from 'vitest'
import { getImageAspectWarning } from '@goodparty_org/contracts'
import {
  clampCropToPhoneRatio,
  coversWholeImage,
  defaultCrop,
  fitPixelsToPhoneRatio,
} from './smsCrop.util'

describe('clampCropToPhoneRatio', () => {
  it('keeps a box already inside the phone range', () => {
    const box = { x: 5, y: 5, width: 200, height: 100 }
    expect(clampCropToPhoneRatio(box)).toBe(box)
  })

  it('narrows a box wider than 2:1 to exactly 2:1', () => {
    expect(
      clampCropToPhoneRatio({ x: 0, y: 10, width: 300, height: 100 }),
    ).toEqual({ x: 0, y: 10, width: 200, height: 100 })
  })

  it('shortens a box taller than 1:2 to exactly 1:2', () => {
    expect(
      clampCropToPhoneRatio({ x: 4, y: 0, width: 100, height: 300 }),
    ).toEqual({ x: 4, y: 0, width: 100, height: 200 })
  })

  it('leaves an empty box alone', () => {
    const box = { x: 3, y: 3, width: 0, height: 0 }
    expect(clampCropToPhoneRatio(box)).toBe(box)
  })
})

describe('defaultCrop', () => {
  it('opens inset on an image a phone shows uncropped, so the cut edge shows', () => {
    expect(defaultCrop(400, 300)).toEqual({
      x: 40,
      y: 30,
      width: 320,
      height: 240,
    })
  })

  it('centers an inset box inside the widest allowed shape on a 3:1 banner', () => {
    const box = defaultCrop(900, 300)
    expect(box).toEqual({ x: 210, y: 30, width: 480, height: 240 })
    expect(getImageAspectWarning(box.width, box.height)).toBeNull()
  })

  it('centers an inset box inside the tallest allowed shape on a tall image', () => {
    const box = defaultCrop(300, 900)
    expect(box).toEqual({ x: 30, y: 210, width: 240, height: 480 })
    expect(getImageAspectWarning(box.width, box.height)).toBeNull()
  })
})

describe('coversWholeImage', () => {
  it('is true for the full frame and false once a side is trimmed', () => {
    expect(
      coversWholeImage({ x: 0, y: 0, width: 400, height: 300 }, 400, 300),
    ).toBe(true)
    expect(
      coversWholeImage({ x: 10, y: 0, width: 390, height: 300 }, 400, 300),
    ).toBe(false)
  })
})

describe('fitPixelsToPhoneRatio', () => {
  it('floors a box scaled from a 2:1 display crop so it never warns', () => {
    // 406x203 on screen of a 1500x500 image shown at 608 wide
    const scale = 1500 / 608
    const size = fitPixelsToPhoneRatio(406 * scale, 203 * scale)
    expect(size.width).toBeLessThanOrEqual(size.height * 2)
    expect(getImageAspectWarning(size.width, size.height)).toBeNull()
  })

  it('trims a width rounded one pixel past 2:1', () => {
    expect(fitPixelsToPhoneRatio(1002, 500.6)).toEqual({
      width: 1000,
      height: 500,
    })
  })

  it('trims a height rounded one pixel past 1:2', () => {
    expect(fitPixelsToPhoneRatio(250, 501)).toEqual({ width: 250, height: 500 })
  })

  it('keeps sizes inside the range', () => {
    expect(fitPixelsToPhoneRatio(800.4, 600.9)).toEqual({
      width: 800,
      height: 600,
    })
  })
})
