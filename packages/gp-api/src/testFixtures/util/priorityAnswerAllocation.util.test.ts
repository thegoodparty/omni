import { describe, expect, it } from 'vitest'
import { PriorityAnswerCode } from '@/generated/prisma'
import { ADULT_AGE_BANDS } from '@/peopleDb/databricks/districtCensusSql.util'
import {
  estimateMrp,
  type MrpAnswerCell,
  type MrpFrameCell,
} from '@/priorities/util/mrp.util'
import { mrpReadStatus } from '@/priorities/util/mrpReadStatus.util'
import {
  allocateAnswers,
  answerCodes,
  readGroups,
  SEED_VOICES_PER_GROUP,
  seedValuesOf,
  type SeedValues,
} from './priorityAnswerAllocation.util'

const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// Sixteen tracts the district holds whole, and four the district line cuts
// through: the census counts their block groups whole, so each is a major
// group of the frame while holding almost none of the voter file.
const WHOLE = Array.from({ length: 16 }, (_, i) => `0800100${1000 + i}`)
const CUT = Array.from({ length: 4 }, (_, i) => `0800100${2000 + i}`)
const TRACTS = [...WHOLE, ...CUT]
const GENDERS = ['male', 'female'] as const

const frame: MrpFrameCell[] = ADULT_AGE_BANDS.flatMap(({ key }) =>
  GENDERS.flatMap((gender) =>
    TRACTS.map((tract) => ({
      count: CUT.includes(tract) ? 300 : 550,
      values: { age: key, gender, tract },
    })),
  ),
)

interface Resident {
  id: string
  values: SeedValues
  // Where they live, which the seed only knows for a tract's draw.
  tract: string
}

const residentOf = (
  next: () => number,
  id: string,
  tract: string,
  known: boolean,
): Resident => {
  const band = ADULT_AGE_BANDS[Math.floor(next() * ADULT_AGE_BANDS.length)]!
  const person = {
    age: band.minAge + 2,
    gender: next() < 0.5 ? ('Male' as const) : ('Female' as const),
    ethnicityGroup: null,
  }
  return { id, tract, values: seedValuesOf(person, known ? tract : null) }
}

// The seed's district sample, drawn from the voter file, then a few
// residents from each major tract, the way the seed draws them.
const residents = (): Resident[] => {
  const next = random(7)
  const sample = Array.from({ length: 240 }, (_, i) => {
    const tract =
      next() < 0.02
        ? CUT[Math.floor(next() * CUT.length)]!
        : WHOLE[Math.floor(next() * WHOLE.length)]!
    return residentOf(next, `sample-${i}`, tract, false)
  })
  const drawn = TRACTS.flatMap((tract) =>
    Array.from({ length: 6 }, (_, i) =>
      residentOf(next, `${tract}-${i}`, tract, true),
    ),
  )
  return [...sample, ...drawn]
}

const YES: Record<PriorityAnswerCode, number> = {
  yes: 1,
  no: 0,
  mixed: 0.5,
  not_an_answer: 0,
}

const readOf = (answering: Resident[], split?: 'lean' | 'even') => {
  const codes = answerCodes(answering, split)
  const answers: MrpAnswerCell[] = answering.map((resident, index) => ({
    yes: YES[codes[index]!],
    answers: 1,
    values: {
      age: resident.values.age ?? null,
      gender: resident.values.gender ?? null,
      tract: resident.tract,
    },
  }))
  return mrpReadStatus({
    answers: answering.length,
    read: { result: estimateMrp(answers, frame, {}), raceNameable: false },
  })
}

describe('readGroups', () => {
  it('names every age band, both sexes and every major tract', () => {
    const groups = readGroups(frame)

    expect(groups.filter((g) => g.dimension === 'age')).toHaveLength(6)
    expect(groups.filter((g) => g.dimension === 'gender')).toHaveLength(2)
    expect(
      groups.filter((g) => g.dimension === 'tract').map((g) => g.value),
    ).toEqual(TRACTS)
  })
})

describe('allocateAnswers', () => {
  const all = residents()
  const groups = readGroups(frame)

  it('gives every major group its voices at the default size', () => {
    const answering = allocateAnswers(all, groups, all.length)

    for (const { dimension, value } of groups) {
      const voices = answering.filter(
        (resident) => resident.values[dimension] === value,
      )
      expect(voices.length).toBeGreaterThanOrEqual(SEED_VOICES_PER_GROUP)
    }
  })

  it('leaves the cut tracts unheard from the district sample alone', () => {
    const sample = all.filter((resident) => resident.values.tract === null)

    const read = readOf(allocateAnswers(sample, groups, sample.length))

    expect(read.status).toBe('tooEarly')
    expect(read.unheard).toContain('unreachedAreas')
  })

  it('reads as every group heard when everyone answers', () => {
    const read = readOf(allocateAnswers(all, groups, all.length))

    expect(read).toMatchObject({ status: 'representative', good: true })
    expect(read.groupsHeard).toBe(read.groupsTotal)
  })

  it('hears every group, men too, but stays unsure on an even split', () => {
    const answering = allocateAnswers(all, groups, all.length)
    const codes = answerCodes(answering, 'even')

    const men = codes.filter(
      (_, index) => answering[index]!.values.gender === 'male',
    )
    expect(new Set(men)).toEqual(new Set(['yes', 'no']))
    const read = readOf(answering, 'even')
    expect(read.status).toBe('gettingClose')
    expect(read.groupsHeard).toBe(read.groupsTotal)
  })

  it('spreads a small number of answers across every group', () => {
    const read = readOf(allocateAnswers(all, groups, 40))

    expect(read.status).toBe('notYetRepresentative')
    expect(read.unheard).toEqual([])
  })

  it('keeps the given order once every group has its voices', () => {
    const plain = all.slice(0, 10)

    expect(allocateAnswers(plain, [], 4)).toEqual(plain.slice(0, 4))
  })
})
