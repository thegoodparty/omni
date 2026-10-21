import { describe, expect, it } from 'vitest'
import {
  deriveRobocallProtectedParts,
  formatRobocallCallbackNumber,
  robocallDisclosureLine,
} from './RobocallProtectedParts'

const SCRIPT =
  'This is Sarah, candidate for City Council. I want to fix our roads.\n\n' +
  'Paid for by Sarah Chen for City Council, 855-765-1388.'

const textsFor = (script: string) =>
  Object.fromEntries(
    deriveRobocallProtectedParts(script, {
      candidateNames: ['Sarah Chen'],
    }).map((part) => [part.rule, part.text]),
  )

describe('robocallDisclosureLine', () => {
  it('names the sponsor and reads the number grouped', () => {
    expect(
      robocallDisclosureLine('Sarah Chen for City Council', '18557651388'),
    ).toBe('Paid for by Sarah Chen for City Council, 855-765-1388.')
  })

  it('leaves a number it cannot group as given', () => {
    expect(formatRobocallCallbackNumber('+44 20 7946 0958')).toBe(
      '+44 20 7946 0958',
    )
  })
})

describe('deriveRobocallProtectedParts', () => {
  it('locks the name the candidate gives and the whole disclosure line', () => {
    expect(textsFor(SCRIPT)).toEqual({
      candidate_name: 'Sarah',
      disclosure: 'Paid for by Sarah Chen for City Council, 855-765-1388.',
    })
  })

  it('places each part where it sits in the script', () => {
    for (const part of deriveRobocallProtectedParts(SCRIPT, {
      candidateNames: ['Sarah Chen'],
    })) {
      expect(SCRIPT.slice(part.start, part.start + part.text.length)).toBe(
        part.text,
      )
    }
  })

  // The body may say "paid for by" too; the closing line is the disclosure.
  it('locks the last paid-for-by line, not an earlier mention', () => {
    const script =
      'This is Sarah. These roads were paid for by all of us.\n\n' +
      'Paid for by Sarah Chen for City Council, 855-765-1388.'
    expect(textsFor(script).disclosure).toBe(
      'Paid for by Sarah Chen for City Council, 855-765-1388.',
    )
  })

  it('does not take the name from inside the disclosure', () => {
    const script =
      'Vote on Tuesday.\n\nPaid for by Sarah Chen for City Council, 855-765-1388.'
    expect(textsFor(script).candidate_name).toBeUndefined()
  })

  it('locks nothing a script does not have', () => {
    expect(textsFor('Vote on Tuesday.')).toEqual({})
  })
})
