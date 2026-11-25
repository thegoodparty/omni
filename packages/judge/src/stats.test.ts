import { describe, expect, it } from 'vitest'
import {
  CONFIRMING_ATTEMPTS,
  cannotJudge,
  readCaseVerdict,
  readVerdict,
  type PairReading,
} from './stats'

const change = (
  criterion: string,
  direction: 'better' | 'worse',
): PairReading['changes'][number] => ({
  criterion,
  direction,
  evidence: [`base no, candidate yes on ${criterion}`],
})

const reading = (
  attempt: number,
  changes: PairReading['changes'] = [],
  disagreements: string[] = [],
): PairReading => ({ attempt, changes, disagreements })

const none = reading(1)

describe('cannotJudge', () => {
  it('is true when nothing was judged', () => {
    expect(cannotJudge(0, 0)).toBe(true)
    expect(cannotJudge(0, 3)).toBe(true)
  })

  it('is true when more than half the pairs were not judged', () => {
    expect(cannotJudge(2, 3)).toBe(true)
  })

  it('is false at exactly half', () => {
    expect(cannotJudge(3, 3)).toBe(false)
  })

  it('is false when most pairs were judged', () => {
    expect(cannotJudge(9, 1)).toBe(false)
  })
})

describe('CONFIRMING_ATTEMPTS', () => {
  it('is two of one case three attempts', () => {
    expect(CONFIRMING_ATTEMPTS).toBe(2)
  })
})

describe('readCaseVerdict', () => {
  it('confirms nothing from a single attempt, however lopsided', () => {
    // One attempt is one grading of one pair. It cannot tell a repeated
    // behavior from a reading that happened to move, so it is not confirmation.
    const tally = readCaseVerdict({
      caseId: 'a1',
      readings: [reading(1, [change('grounding', 'worse')]), none, none],
    })
    expect(tally.confirmed).toEqual([])
    expect(tally.verdict).toBe('NO DIFFERENCE FOUND')
  })

  it('confirms a regression both orders agreed on in two attempts', () => {
    const tally = readCaseVerdict({
      caseId: 'a1',
      readings: [
        reading(1, [change('grounding', 'worse')]),
        reading(2, [change('grounding', 'worse')]),
        none,
      ],
    })
    expect(tally.confirmed).toHaveLength(1)
    expect(tally.confirmed[0]).toMatchObject({
      caseId: 'a1',
      criterion: 'grounding',
      direction: 'worse',
    })
    expect(tally.confirmed[0]?.attempts.map(({ attempt }) => attempt)).toEqual([
      1, 2,
    ])
    expect(tally.verdict).toBe('WORSE')
  })

  it('does not count duplicate readings as distinct attempts', () => {
    const loss = reading(1, [change('grounding', 'worse')])
    const tally = readCaseVerdict({ caseId: 'a1', readings: [loss, loss] })
    expect(tally.confirmed).toEqual([])
  })

  it('confirms an improvement two attempts agreed on', () => {
    const tally = readCaseVerdict({
      caseId: 'a1',
      readings: [
        reading(1, [change('specificity', 'better')]),
        reading(2, [change('specificity', 'better')]),
        reading(3, [change('specificity', 'better')]),
      ],
    })
    expect(tally.verdict).toBe('BETTER')
  })

  it('will not confirm two attempts pulling in opposite directions', () => {
    const tally = readCaseVerdict({
      caseId: 'a1',
      readings: [
        reading(1, [change('grounding', 'worse')]),
        reading(2, [change('grounding', 'better')]),
        none,
      ],
    })
    expect(tally.confirmed).toEqual([])
    expect(tally.verdict).toBe('NO DIFFERENCE FOUND')
  })

  it('does not pool two different criteria into one confirmation', () => {
    const tally = readCaseVerdict({
      caseId: 'a1',
      readings: [
        reading(1, [change('grounding', 'worse')]),
        reading(2, [change('specificity', 'worse')]),
        none,
      ],
    })
    expect(tally.confirmed).toEqual([])
  })

  it('is WORSE when a regression is confirmed alongside an improvement', () => {
    const tally = readCaseVerdict({
      caseId: 'a1',
      readings: [
        reading(1, [
          change('grounding', 'worse'),
          change('specificity', 'better'),
        ]),
        reading(2, [
          change('grounding', 'worse'),
          change('specificity', 'better'),
        ]),
        none,
      ],
    })
    expect(tally.confirmed.map(({ direction }) => direction)).toEqual([
      'worse',
      'better',
    ])
    expect(tally.verdict).toBe('WORSE')
  })

  it('counts an actual tie apart from a disagreement', () => {
    const tally = readCaseVerdict({
      caseId: 'a1',
      readings: [none, none, reading(3, [], ['grounding'])],
    })
    expect(tally.ties).toBe(2)
    expect(tally.disagreements).toEqual([
      { attempt: 3, criteria: ['grounding'] },
    ])
    expect(tally.verdict).toBe('NO DIFFERENCE FOUND')
  })

  it('reads the pass rule as a criterion of its own', () => {
    const tally = readCaseVerdict({
      caseId: 'a1',
      readings: [
        reading(1, [change('handledWhen', 'worse')]),
        reading(2, [change('handledWhen', 'worse')]),
        none,
      ],
    })
    expect(tally.confirmed[0]?.criterion).toBe('handledWhen')
    expect(tally.verdict).toBe('WORSE')
  })

  it('reports the attempts it judged and the ones it did not', () => {
    const tally = readCaseVerdict({
      caseId: 'a1',
      readings: [none, reading(2, [change('grounding', 'worse')], ['tone'])],
      notJudged: 1,
    })
    expect(tally.judged).toBe(2)
    expect(tally.notJudged).toBe(1)
    expect(tally.verdict).toBe('NO DIFFERENCE FOUND')
  })
})

describe('readVerdict', () => {
  it('is WORSE on one confirmed regression, whatever else was found', () => {
    const verdict = readVerdict({
      cases: [
        readCaseVerdict({
          caseId: 'a1',
          readings: [
            reading(1, [change('grounding', 'worse')]),
            reading(2, [change('grounding', 'worse')]),
            none,
          ],
        }),
        readCaseVerdict({
          caseId: 'a2',
          readings: [
            reading(1, [change('specificity', 'better')]),
            reading(2, [change('specificity', 'better')]),
            reading(3, [change('specificity', 'better')]),
          ],
        }),
      ],
      notJudged: 0,
    })
    expect(verdict.label).toBe('WORSE')
    expect(verdict.confirmed.map(({ direction }) => direction)).toEqual([
      'worse',
      'better',
    ])
  })

  it('is BETTER on a confirmed improvement and no regression', () => {
    const verdict = readVerdict({
      cases: [
        readCaseVerdict({
          caseId: 'a1',
          readings: [
            reading(1, [change('specificity', 'better')]),
            reading(2, [change('specificity', 'better')]),
            none,
          ],
        }),
      ],
      notJudged: 0,
    })
    expect(verdict.label).toBe('BETTER')
  })

  it('is NO DIFFERENCE FOUND when nothing was confirmed', () => {
    const verdict = readVerdict({
      cases: [readCaseVerdict({ caseId: 'a1', readings: [none, none, none] })],
      notJudged: 0,
    })
    expect(verdict.label).toBe('NO DIFFERENCE FOUND')
  })

  it('is NO DIFFERENCE FOUND for one lopsided case, with no significance test', () => {
    const verdict = readVerdict({
      cases: [
        readCaseVerdict({
          caseId: 'a1',
          readings: [
            reading(1, [change('grounding', 'worse')]),
            reading(2, [change('grounding', 'worse')]),
            reading(3, [change('grounding', 'worse')]),
          ],
        }),
      ],
      notJudged: 0,
    })
    expect(verdict.label).toBe('WORSE')
  })

  it("is CAN'T JUDGE when most pairs never reached the grader", () => {
    const verdict = readVerdict({
      cases: [
        readCaseVerdict({
          caseId: 'a1',
          readings: [reading(1, [change('specificity', 'better')])],
          notJudged: 2,
        }),
      ],
      notJudged: 2,
    })
    expect(verdict.label).toBe("CAN'T JUDGE")
  })

  it("is CAN'T JUDGE when no pair reached the grader at all", () => {
    const verdict = readVerdict({
      cases: [readCaseVerdict({ caseId: 'a1', readings: [], notJudged: 3 })],
      notJudged: 3,
    })
    expect(verdict.label).toBe("CAN'T JUDGE")
    expect(verdict.judged).toBe(0)
  })

  it('reads a verdict when exactly half the pairs were judged', () => {
    const verdict = readVerdict({
      cases: [
        readCaseVerdict({
          caseId: 'a1',
          readings: [
            reading(1, [change('specificity', 'better')]),
            reading(2, [change('specificity', 'better')]),
            none,
          ],
          notJudged: 3,
        }),
      ],
      notJudged: 3,
    })
    expect(verdict.label).toBe('BETTER')
  })

  it("is CAN'T JUDGE when one case has no judgments despite coverage elsewhere", () => {
    const verdict = readVerdict({
      cases: [
        readCaseVerdict({ caseId: 'a1', readings: [none, reading(2), reading(3)] }),
        readCaseVerdict({ caseId: 'a2', readings: [], notJudged: 3 }),
      ],
      notJudged: 3,
    })
    expect(verdict.label).toBe("CAN'T JUDGE")
  })

  it("prefers a confirmed regression over CAN'T JUDGE coverage", () => {
    // The regression is already established; missing coverage elsewhere must not
    // hide it.
    const verdict = readVerdict({
      cases: [
        readCaseVerdict({
          caseId: 'a1',
          readings: [
            reading(1, [change('grounding', 'worse')]),
            reading(2, [change('grounding', 'worse')]),
            reading(3),
          ],
        }),
        readCaseVerdict({ caseId: 'a2', readings: [], notJudged: 3 }),
      ],
      notJudged: 3,
    })
    expect(verdict.label).toBe('WORSE')
  })

  it('names the case and criterion in the confirmed evidence', () => {
    const verdict = readVerdict({
      cases: [
        readCaseVerdict({
          caseId: 'a2-thin',
          readings: [
            reading(1, [change('disclosure', 'worse')]),
            reading(2, [change('disclosure', 'worse')]),
            none,
          ],
        }),
      ],
      notJudged: 0,
    })
    expect(verdict.confirmed[0]).toMatchObject({
      caseId: 'a2-thin',
      criterion: 'disclosure',
      direction: 'worse',
    })
  })
})
