import type { FocusOption, OnboardingFocusKind } from '@goodparty_org/contracts'
import {
  FirstWinHorizon,
  FocusFactSource,
  PriorityFocusOptionKind,
  ResidentInterest,
} from '../../generated/prisma'

export const FOCUS_CARD_COUNT = 3

const RECAP_LINE_MAX_LENGTH = 80

// A card as the welcome shows it, plus where each fact came from. The
// sources are stored with the pick and never returned to a client.
export type FocusCard = FocusOption & {
  residentInterestSource: FocusFactSource
  firstWinSource: FocusFactSource
}

type Fact<T> = { value: T; source: FocusFactSource }

// The welcome never leaves a line blank: a fact no search has placed yet
// reads Medium or Months until the real value lands.
const factOr = <T>(
  value: T | null,
  source: FocusFactSource | null,
  fallback: T,
): Fact<T> =>
  value !== null && source !== null
    ? { value, source }
    : { value: fallback, source: FocusFactSource.default }

export const residentInterestFact = (
  value: ResidentInterest | null,
  source: FocusFactSource | null,
): Fact<ResidentInterest> => factOr(value, source, ResidentInterest.medium)

export const firstWinFact = (
  value: FirstWinHorizon | null,
  source: FocusFactSource | null,
): Fact<FirstWinHorizon> => factOr(value, source, FirstWinHorizon.months)

// A model's phrase for "We'll help you make progress on ___.", or null when
// it is unusable and the card falls back to its title.
export const cleanRecapLine = (
  value: string | null | undefined,
): string | null => {
  const line = (value ?? '').trim().replace(/[\s.]+$/, '')
  return line.length > 0 && line.length <= RECAP_LINE_MAX_LENGTH ? line : null
}

// Something many residents are asking for that could see a first win in
// weeks, or failing that months. A placeholder first win never qualifies.
const isQuickWin = (card: FocusCard, horizons: FirstWinHorizon[]): boolean =>
  card.residentInterest === ResidentInterest.high &&
  card.firstWinSource !== FocusFactSource.default &&
  horizons.includes(card.firstWin)

const QUICK_HORIZONS = [FirstWinHorizon.weeks, FirstWinHorizon.months]

const firstQuickWin = (list: FocusCard[]): FocusCard | undefined =>
  list.find((card) => isQuickWin(card, [FirstWinHorizon.weeks])) ??
  list.find((card) => isQuickWin(card, [FirstWinHorizon.months]))

// The community issues offered keep their rank order. The quick win is the
// first one in weeks, else the first in months; when it sits below the ones
// that would show, it takes the last slot.
const pickCards = (
  list: FocusCard[],
  count: number,
  needQuick: boolean,
): FocusCard[] => {
  const top = list.slice(0, count)
  const quick = needQuick ? firstQuickWin(list) : undefined
  return !quick || top.includes(quick)
    ? top
    : [...top.slice(0, count - 1), quick]
}

// Every issue they ran on, never cut. With fewer than three, the top
// community issues fill up to three, and the quick-win rule applies to those
// only when no ran-on card is already a quick win.
export const focusCards = (
  ranOn: FocusCard[],
  community: FocusCard[],
): FocusCard[] =>
  ranOn.length >= FOCUS_CARD_COUNT
    ? ranOn
    : [
        ...ranOn,
        ...pickCards(
          community,
          FOCUS_CARD_COUNT - ranOn.length,
          !ranOn.some((card) => isQuickWin(card, QUICK_HORIZONS)),
        ),
      ]

export const focusKindOf = (cards: FocusCard[]): OnboardingFocusKind => {
  const ranOn = cards.filter(
    (card) => card.kind === PriorityFocusOptionKind.ran_on,
  ).length
  if (ranOn === 0) return 'community'
  return ranOn === cards.length ? 'ran_on' : 'mixed'
}
