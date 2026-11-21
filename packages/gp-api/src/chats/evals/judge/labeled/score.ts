import type { LabelDeclaration, LabeledCase } from '../cases'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from '../config'
import type { Arm, CiContext, RunRecord } from '../record'
import type { ControlsScoredAnyway, VerdictLabel } from '../score'
import { signTest, type SignTest } from '../signTest'
import { LabeledOutputSchema } from './run'
import type { LabelAnswer, LabelValue } from './types'

// THE LABELED VERDICT, with no panel. Both arms are scored against the
// CANDIDATE's expected labels, because the case list is part of the branch
// under review; when the base ref's list says something else for a case, the
// report names it.
//
// A case is right for an arm when every label is right. The cases where one
// arm is right and the other is not are the evidence, and they go through
// the same exact sign test the panel's small-sample verdict uses (McNemar's
// exact test, in effect). A floor label adds one hard rule on top: a case
// where the base arm said `true` and the candidate said `false` is WORSE on
// its own, whatever the count says.

export interface LabelAccuracy {
  name: string
  correct: number
  // Mean Brier over the paired cases, or null for a score label, where
  // there is no distribution to score. Lower is better: 0 is certain and
  // right, 1 is certain and wrong on a boolean.
  brier: number | null
}

export interface LabeledArmScore {
  // Cases with every label right, of `LabeledScore.pairedCases`.
  allCorrect: number
  labels: readonly LabelAccuracy[]
  // True when every answer this arm gave carried probabilities. A hard
  // label counts as probability 1 on its value, so a hard arm's Brier is its
  // error rate.
  probabilistic: boolean
}

export interface DiscordantCase {
  caseId: string
  favours: Arm
  // The labels each arm got wrong on this case, by name.
  wrong: Readonly<Record<Arm, readonly string[]>>
}

export interface FloorBreach {
  caseId: string
  label: string
}

export type LabeledExclusionWhy = 'missing' | 'infraError' | 'unreadable'

export interface LabeledExclusion {
  caseId: string
  arm: Arm
  why: LabeledExclusionWhy
}

export interface LabeledScore {
  agentId: string
  label: VerdictLabel
  labelNote: string
  // Scored cases with a readable answer on both arms.
  pairedCases: number
  base: LabeledArmScore
  candidate: LabeledArmScore
  discordant: readonly DiscordantCase[]
  sign: SignTest | null
  floorBreaches: readonly FloorBreach[]
  // Runs with no usable answer. A candidate's `unreadable` run is still
  // scored, as no answer on every label; every other one left its case out.
  excluded: readonly LabeledExclusion[]
  // Controls held out of the verdict (both refs mark them `scored: false`).
  unscored: readonly string[]
  // Controls only this branch marks, scored anyway and named.
  controlsScoredAnyway?: ControlsScoredAnyway
  // Cases whose expected labels this branch's list adds or changes against
  // the base ref's, or null when the base list could not be read.
  expectedChanged: readonly string[] | null
  ci: CiContext | null
}

export interface LabeledScoreInput {
  agentId: string
  records: readonly RunRecord[]
  labels: readonly LabelDeclaration[]
  cases: readonly LabeledCase[]
  unscoredCaseIds: ReadonlySet<string>
  controlsScoredAnyway?: ControlsScoredAnyway
  // The base ref's expected labels by case, or null when unreadable.
  baseExpected: ReadonlyMap<string, Readonly<Record<string, LabelValue>>> | null
}

type Answers = Readonly<Record<string, LabelAnswer>>

const readAnswers = (
  record: RunRecord | undefined,
): Answers | LabeledExclusionWhy => {
  if (record === undefined) return 'missing'
  if (record.status === 'infraError' || record.output === null) {
    return 'infraError'
  }
  const parsed = LabeledOutputSchema.safeParse(record.output.value)
  return parsed.success ? parsed.data : 'unreadable'
}

const isCorrect = (
  answer: LabelAnswer | undefined,
  expected: LabelValue,
): boolean => answer !== undefined && answer.value === expected

// The options a label's distribution is over, keyed as String(option).
const optionsOf = (label: LabelDeclaration): string[] =>
  label.type === 'choice' ? label.options : ['true', 'false']

// The arm's distribution over the options. A hard answer is all its mass on
// its value.
const distributionOf = (
  label: LabelDeclaration,
  answer: LabelAnswer,
): Record<string, number> => {
  const options = optionsOf(label)
  const given = answer.probabilities
  if (given === undefined) {
    return { [String(answer.value)]: 1 }
  }
  if (label.type === 'boolean') {
    const pTrue =
      given.true ?? (given.false === undefined ? undefined : 1 - given.false)
    return pTrue === undefined
      ? { [String(answer.value)]: 1 }
      : { true: pTrue, false: 1 - pTrue }
  }
  return Object.fromEntries(options.map((o) => [o, given[o] ?? 0]))
}

// Brier for one case: the squared distance between the distribution and
// the truth, summed over the options. On a boolean that is twice the usual
// one-probability form, (p - o)^2, so it is halved to read as that form; a
// choice keeps the multi-class sum, 0 to 2.
const brierOf = (
  label: LabelDeclaration,
  answer: LabelAnswer | undefined,
  expected: LabelValue,
): number | null => {
  if (label.type === 'score') return null
  // A label the arm left out scores as certain and wrong, the worst there is.
  if (answer === undefined) return label.type === 'boolean' ? 1 : 2
  const p = distributionOf(label, answer)
  const sum = optionsOf(label).reduce((total, option) => {
    const truth = option === String(expected) ? 1 : 0
    return total + ((p[option] ?? 0) - truth) ** 2
  }, 0)
  return label.type === 'boolean' ? sum / 2 : sum
}

const mean = (values: readonly number[]): number =>
  values.reduce((sum, v) => sum + v, 0) / values.length

interface PairedCase {
  one: LabeledCase
  answers: Readonly<Record<Arm, Answers>>
}

const armScore = (
  arm: Arm,
  labels: readonly LabelDeclaration[],
  paired: readonly PairedCase[],
): LabeledArmScore => ({
  allCorrect: paired.filter(({ one, answers }) =>
    labels.every((l) =>
      isCorrect(answers[arm][l.name], one.expected[l.name] ?? ''),
    ),
  ).length,
  labels: labels.map((label) => {
    const briers = paired.flatMap(({ one, answers }) => {
      const b = brierOf(
        label,
        answers[arm][label.name],
        one.expected[label.name] ?? '',
      )
      return b === null ? [] : [b]
    })
    return {
      name: label.name,
      correct: paired.filter(({ one, answers }) =>
        isCorrect(answers[arm][label.name], one.expected[label.name] ?? ''),
      ).length,
      brier: briers.length === 0 ? null : mean(briers),
    }
  }),
  probabilistic:
    paired.length > 0 &&
    paired.every(({ answers }) =>
      labels.every((l) => answers[arm][l.name]?.probabilities !== undefined),
    ),
})

const wrongLabels = (
  labels: readonly LabelDeclaration[],
  one: LabeledCase,
  answers: Answers,
): string[] =>
  labels
    .filter((l) => !isCorrect(answers[l.name], one.expected[l.name] ?? ''))
    .map((l) => l.name)

// Compared with sorted keys, so a list that reorders a case's labels has not
// changed what it expects.
const sameExpected = (
  a: Readonly<Record<string, LabelValue>>,
  b: Readonly<Record<string, LabelValue>>,
): boolean => {
  const keys = Object.keys(a).sort()
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => a[key] === b[key])
  )
}

const verdictOf = (
  pairedCases: number,
  discordant: readonly DiscordantCase[],
  sign: SignTest | null,
  floorBreaches: readonly FloorBreach[],
  candidateMissing: number,
  config: JudgeConfig,
): { label: VerdictLabel; note: string } => {
  const counted = countedVerdict(
    pairedCases,
    discordant,
    sign,
    floorBreaches,
    config,
  )
  // A CANDIDATE RUN THAT NEVER ANSWERED cannot be checked against the floor
  // or the count, so it may not leave a better or same verdict standing: the
  // case it dropped could be the opt-out it missed. WORSE stays WORSE.
  if (candidateMissing === 0 || counted.label === 'WORSE') return counted
  return {
    label: "CAN'T SAY",
    note:
      `${candidateMissing} case(s) have no candidate answer, so the floor ` +
      `and the count cannot be checked on them (without them: ` +
      `${counted.label}, ${counted.note})`,
  }
}

const countedVerdict = (
  pairedCases: number,
  discordant: readonly DiscordantCase[],
  sign: SignTest | null,
  floorBreaches: readonly FloorBreach[],
  config: JudgeConfig,
): { label: VerdictLabel; note: string } => {
  if (floorBreaches.length > 0) {
    return {
      label: 'WORSE',
      note:
        `the candidate answered false on ${floorBreaches.length} floor ` +
        'label(s) the base arm answered true, which decides the verdict ' +
        'on its own',
    }
  }
  if (pairedCases === 0) {
    return {
      label: "CAN'T SAY",
      note: 'no scored case had a readable answer on both arms',
    }
  }
  if (discordant.length === 0 || sign === null) {
    return {
      label: 'SAME',
      note:
        `no case was right on one arm and wrong on the other, over ` +
        `${pairedCases} case(s)`,
    }
  }
  const { alpha } = config.gates.sign
  const votes = sign.forCandidate + sign.forBase
  const p = (value: number): string => value.toFixed(3)
  if (sign.pBetter < alpha) {
    return {
      label: 'BETTER',
      note:
        `${sign.forCandidate} of ${votes} discordant cases favoured the ` +
        `candidate (p = ${p(sign.pBetter)})`,
    }
  }
  if (sign.pWorse < alpha) {
    return {
      label: 'WORSE',
      note:
        `${sign.forBase} of ${votes} discordant cases favoured the base ` +
        `(p = ${p(sign.pWorse)})`,
    }
  }
  return {
    label: "CAN'T SAY",
    note:
      `${votes} discordant case(s), ${sign.forCandidate} for the candidate ` +
      `and ${sign.forBase} for the base (p = ${p(sign.pBetter)} for BETTER, ` +
      `${p(sign.pWorse)} for WORSE), which chance can explain`,
  }
}

// The first attempt's record, the only one a labeled arm writes.
const recordFor = (
  records: readonly RunRecord[],
  caseId: string,
  arm: Arm,
): RunRecord | undefined =>
  records
    .filter((r) => r.caseId === caseId && r.arm === arm)
    .sort((a, b) => a.attempt - b.attempt)[0]

export const scoreLabeled = (
  input: LabeledScoreInput,
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
): LabeledScore => {
  const { labels, records } = input
  const floors = labels.filter((l) => l.type === 'boolean' && l.floor)
  const excluded: LabeledExclusion[] = []
  const paired: PairedCase[] = []
  const floorBreaches: FloorBreach[] = []

  let candidateMissing = 0

  for (const one of input.cases) {
    const base = readAnswers(recordFor(records, one.caseId, 'base'))
    const read = readAnswers(recordFor(records, one.caseId, 'candidate'))
    // OUTPUT THAT IS NOT LABELS IS THE CANDIDATE'S OWN ANSWER, and a wrong
    // one: the classifier ran and said nothing usable. It is scored as no
    // answer on every label, so it misses the floor wherever the base caught
    // one. A run that failed or never ran is a harness fault, and is excluded
    // like any other shape's infraError.
    if (read === 'unreadable') {
      excluded.push({ caseId: one.caseId, arm: 'candidate', why: read })
    }
    const candidate: Answers | LabeledExclusionWhy =
      read === 'unreadable' ? {} : read
    if (typeof base === 'string' || typeof candidate === 'string') {
      if (typeof base === 'string') {
        excluded.push({ caseId: one.caseId, arm: 'base', why: base })
      }
      if (typeof candidate === 'string') {
        excluded.push({ caseId: one.caseId, arm: 'candidate', why: candidate })
        candidateMissing += 1
      }
      continue
    }
    // Every paired case, controls included: the floor is a rule about what
    // the candidate may never do, not a statistic.
    for (const label of floors) {
      if (
        base[label.name]?.value === true &&
        candidate[label.name]?.value !== true
      ) {
        floorBreaches.push({ caseId: one.caseId, label: label.name })
      }
    }
    if (input.unscoredCaseIds.has(one.caseId)) continue
    paired.push({ one, answers: { base, candidate } })
  }

  const discordant: DiscordantCase[] = paired.flatMap(({ one, answers }) => {
    const wrong = {
      base: wrongLabels(labels, one, answers.base),
      candidate: wrongLabels(labels, one, answers.candidate),
    }
    if ((wrong.base.length === 0) === (wrong.candidate.length === 0)) return []
    return [
      {
        caseId: one.caseId,
        favours: wrong.base.length === 0 ? 'base' : 'candidate',
        wrong,
      },
    ]
  })
  const sign =
    discordant.length === 0
      ? null
      : signTest(discordant.map((d) => (d.favours === 'candidate' ? 1 : -1)))
  const { label, note } = verdictOf(
    paired.length,
    discordant,
    sign,
    floorBreaches,
    candidateMissing,
    config,
  )

  const baseExpected = input.baseExpected
  const expectedChanged =
    baseExpected === null
      ? null
      : input.cases
          .filter((one) => {
            const onBase = baseExpected.get(one.caseId)
            return onBase === undefined || !sameExpected(one.expected, onBase)
          })
          .map((one) => one.caseId)

  return {
    agentId: input.agentId,
    label,
    labelNote: note,
    pairedCases: paired.length,
    base: armScore('base', labels, paired),
    candidate: armScore('candidate', labels, paired),
    discordant,
    sign,
    floorBreaches,
    excluded,
    unscored: [...input.unscoredCaseIds].sort(),
    ...(input.controlsScoredAnyway !== undefined && {
      controlsScoredAnyway: input.controlsScoredAnyway,
    }),
    expectedChanged,
    ci: records.find((r) => r.ci !== undefined)?.ci ?? null,
  }
}
