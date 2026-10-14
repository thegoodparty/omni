import { Injectable } from '@nestjs/common'
import { ACS_COUNT_KEYS, type AcsCounts } from '../util/representation.util'

export interface CensusRespondent {
  personId: string
  lat: number
  lng: number
}

export interface CensusComposition {
  source: 'sample' | 'census'
  district: AcsCounts
  // One entry per respondent whose block group was found, in any order.
  respondentBlockGroups: AcsCounts[]
}

// Where district and block group demographics come from. The real reader
// needs gp-data-platform's district ACS columns and block group table in
// mart_gp_api, plus each person's block group geoid on the people read; until
// those ship, SampleCensusComposition stands in with figures shaped exactly
// like them, and the page labels them as sample data.
export interface CensusCompositionSource {
  compose(input: {
    districtKey: string
    respondents: CensusRespondent[]
  }): Promise<CensusComposition | null>
}

export const CENSUS_COMPOSITION_SOURCE = 'CensusCompositionSource'

const SAMPLE_BLOCK_GROUPS = 60
// About 1.4 km on a side: neighbors share a sample block group, so a send
// that only reached one part of town shows up as a skew.
const CELLS_PER_DEGREE = 70

const hash = (text: string): number => {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// mulberry32: small, seeded, and the same on every run, so a page reload
// never reshuffles the sample.
const seeded = (seed: number) => () => {
  let t = (seed += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const sampleBlockGroup = (random: () => number): AcsCounts => {
  const population = 600 + Math.round(random() * 1800)
  // Shares a total out by weight, keyed so each part keeps its name.
  const split = <K extends string>(
    total: number,
    weights: Record<K, number>,
  ): ((key: K) => number) => {
    const sum = Object.values<number>(weights).reduce((a, w) => a + w, 0)
    return (key) => Math.round((total * weights[key]) / sum)
  }
  const under18 = Math.round(population * (0.12 + random() * 0.18))
  const over65 = Math.round(population * (0.08 + random() * 0.22))
  const race = split(population, {
    white: 3 + random() * 8,
    black: random() * 3,
    hispanic: random() * 2.5,
    asian: random() * 0.8,
    native: random() * 0.15,
    other: random() * 0.6,
  })
  const adults25 = Math.round(population * (0.6 + random() * 0.15))
  const hs = Math.round(adults25 * (0.75 + random() * 0.22))
  const bachelors = Math.round(hs * (0.2 + random() * 0.55))
  const households = Math.round(population / (1.9 + random() * 0.9))
  const owners = Math.round(households * (0.25 + random() * 0.6))
  const belowPoverty = Math.round(population * (0.04 + random() * 0.24))
  const income = split(households, {
    under25k: 1 + random() * 3,
    from25k: 1 + random() * 2,
    from50k: 1 + random() * 2,
    from75k: 0.5 + random() * 1.5,
    from100k: 0.3 + random() * 1.5,
    from150k: 0.2 + random() * 1.8,
  })
  return {
    totalPopulation: population,
    populationUnder18: under18,
    population65Plus: over65,
    populationRaceUniverse: population,
    populationWhiteNh: race('white'),
    populationBlackNh: race('black'),
    populationNativeAmericanNh: race('native'),
    populationAsianNh: race('asian'),
    populationOtherNh: race('other'),
    populationHispanic: race('hispanic'),
    population25Plus: adults25,
    populationHsOrHigher: hs,
    populationBachelorsOrHigher: bachelors,
    households,
    ownerOccupiedHouseholds: owners,
    populationPovertyUniverse: population,
    populationBelowPoverty: belowPoverty,
    householdsIncomeUniverse: households,
    householdsIncomeUnder25k: income('under25k'),
    householdsIncome25kTo50k: income('from25k'),
    householdsIncome50kTo75k: income('from50k'),
    householdsIncome75kTo100k: income('from75k'),
    householdsIncome100kTo150k: income('from100k'),
    householdsIncome150kPlus: income('from150k'),
  }
}

const sumCounts = (first: AcsCounts, rest: AcsCounts[]): AcsCounts => {
  const total = { ...first }
  for (const group of rest) {
    for (const key of ACS_COUNT_KEYS) total[key] += group[key]
  }
  return total
}

@Injectable()
export class SampleCensusComposition implements CensusCompositionSource {
  async compose(input: {
    districtKey: string
    respondents: CensusRespondent[]
  }): Promise<CensusComposition> {
    const random = seeded(hash(input.districtKey))
    const first = sampleBlockGroup(random)
    const blockGroups = [
      first,
      ...Array.from({ length: SAMPLE_BLOCK_GROUPS - 1 }, () =>
        sampleBlockGroup(random),
      ),
    ]
    const cellOf = ({ lat, lng }: CensusRespondent): number =>
      hash(
        `${Math.floor(lat * CELLS_PER_DEGREE)}:${Math.floor(lng * CELLS_PER_DEGREE)}`,
      ) % SAMPLE_BLOCK_GROUPS
    return {
      source: 'sample',
      district: sumCounts(first, blockGroups.slice(1)),
      respondentBlockGroups: input.respondents.map(
        (respondent) => blockGroups[cellOf(respondent)] ?? first,
      ),
    }
  }
}
