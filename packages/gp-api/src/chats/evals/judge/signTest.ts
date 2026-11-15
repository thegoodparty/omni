// The exact test the verdict uses under `gates.bootstrapMinCases` cases,
// where resampling a handful of case scores reads tighter than the evidence.
//
// One vote per CASE, the same unit the bootstrap resamples: a case's vote is
// the sign of its mean pair score, so a case that ran three attempts is still
// one vote and its attempts never count as three independent reads of one
// input. At one attempt a case is one comparison, which is the background
// shape. A case whose attempts netted to a tie is not a vote.

export interface SignTest {
  forCandidate: number
  forBase: number
  // Exact one-sided binomial tails over the voting cases: the chance that at
  // least this many of them fall one way when the arm makes no difference.
  // One-sided in each direction, as the handling signal is.
  pBetter: number
  pWorse: number
}

const choose = (n: number, k: number): number => {
  if (k < 0 || k > n) return 0
  let result = 1
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i
  return result
}

const atLeast = (k: number, n: number): number => {
  let sum = 0
  for (let i = k; i <= n; i += 1) sum += choose(n, i)
  return Math.min(1, sum / 2 ** n)
}

export const signTest = (caseScores: readonly number[]): SignTest => {
  const forCandidate = caseScores.filter((score) => score > 0).length
  const forBase = caseScores.filter((score) => score < 0).length
  const votes = forCandidate + forBase
  return {
    forCandidate,
    forBase,
    pBetter: atLeast(forCandidate, votes),
    pWorse: atLeast(forBase, votes),
  }
}
