// The two exact tests the verdict is made of. Both are exact rather than
// approximate on purpose: a suite has one pair per attempt, so three to thirty
// observations, where a normal approximation reads far tighter than the
// evidence.

export const choose = (n: number, k: number): number => {
  if (k < 0 || k > n) return 0
  let result = 1
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i
  return result
}

// P(X >= k) for X ~ Binomial(n, 0.5): the chance a coin tosses at least this
// many of the n pairs one way when the two arms make no difference.
export const binomialUpperTail = (k: number, n: number): number => {
  if (n === 0) return 1
  let sum = 0
  for (let i = Math.max(0, k); i <= n; i += 1) sum += choose(n, i)
  return Math.min(1, sum / 2 ** n)
}

export type SignTest = {
  forCandidate: number
  forBase: number
  ties: number
  // One-sided tails, one in each direction.
  pBetter: number
  pWorse: number
}

// An exact sign test over the non-tied pairs: each is a vote for one arm or the
// other, and a tie is not a vote. Direction is read off the tails separately so
// the verdict never has to call a two-sided p significant in the losing
// direction.
export const signTest = (
  votes: readonly ('base' | 'candidate' | 'tie')[],
): SignTest => {
  const forCandidate = votes.filter((vote) => vote === 'candidate').length
  const forBase = votes.filter((vote) => vote === 'base').length
  const ties = votes.filter((vote) => vote === 'tie').length
  const decided = forCandidate + forBase
  return {
    forCandidate,
    forBase,
    ties,
    pBetter: binomialUpperTail(forCandidate, decided),
    pWorse: binomialUpperTail(forBase, decided),
  }
}

const hypergeometric = (
  x: number,
  population: number,
  successes: number,
  draws: number,
): number => {
  if (x < 0 || x > draws) return 0
  return (
    (choose(successes, x) * choose(population - successes, draws - x)) /
    choose(population, draws)
  )
}

// One-sided Fisher exact test on a 2x2 table, in the direction "the candidate
// passed less often than the base". The small counts a suite produces are
// exactly where a chi-square would mislead, and both margins are fixed by the
// run, so the hypergeometric tail is the right null.
//
//            pass  fail
// candidate    a     b
// base         c     d
export const handledRegressionP = (
  candidatePass: number,
  candidateFail: number,
  basePass: number,
  baseFail: number,
): number => {
  const population = candidatePass + candidateFail + basePass + baseFail
  const draws = candidatePass + candidateFail
  const successes = candidatePass + basePass
  let tail = 0
  for (let x = 0; x <= candidatePass; x += 1) {
    tail += hypergeometric(x, population, successes, draws)
  }
  return Math.min(1, tail)
}

export type HandledCounts = {
  basePass: number
  baseTotal: number
  candidatePass: number
  candidateTotal: number
  // One-sided: are the candidate's passes significantly fewer?
  pWorse: number
}

export type SuiteVerdictLabel = 'BETTER' | 'WORSE' | 'NO DIFFERENCE FOUND'

export type SuiteVerdict = {
  label: SuiteVerdictLabel
  sign: SignTest
  handled: HandledCounts
  // The gate the verdict is read against.
  alpha: number
}

export type VerdictInput = {
  votes: readonly ('base' | 'candidate' | 'tie')[]
  handled: HandledCounts
  alpha?: number
}

// BETTER or WORSE at p < alpha over the non-tied pairs; otherwise NO DIFFERENCE
// FOUND. WORSE also when the candidate's handledWhen pass rate drops
// significantly, because a failure both arms share reads as a tie in the
// pairwise comparison — that is the exact blind spot the pass counts cover.
export const readVerdict = ({
  votes,
  handled,
  alpha = 0.05,
}: VerdictInput): SuiteVerdict => {
  const sign = signTest(votes)
  const worse = sign.pWorse < alpha || handled.pWorse < alpha
  const better = sign.pBetter < alpha
  const label: SuiteVerdictLabel = worse
    ? 'WORSE'
    : better
      ? 'BETTER'
      : 'NO DIFFERENCE FOUND'
  return { label, sign, handled, alpha }
}
