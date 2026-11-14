import { describe, expect, it } from 'vitest'
import { getImageAspectWarning } from '@goodparty_org/contracts'
import {
  clampCropToPhoneRatio,
  coversWholeImage,
  defaultCrop,
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
  it('covers the whole image when a phone shows it uncropped', () => {
    expect(defaultCrop(400, 300)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    })
  })

  it('centers the largest allowed box on a 3:1 banner', () => {
    const box = defaultCrop(900, 300)
    expect(box).toEqual({ x: 150, y: 0, width: 600, height: 300 })
    expect(getImageAspectWarning(box.width, box.height)).toBeNull()
  })

  it('centers the largest allowed box on a tall image', () => {
    const box = defaultCrop(300, 900)
    expect(box).toEqual({ x: 0, y: 150, width: 300, height: 600 })
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
