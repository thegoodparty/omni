// Multilevel regression and poststratification (MRP) for one yes/no
// question. Answers fit an additive logistic model: an intercept plus one
// effect per value of each dimension (age band, tract, ...), each dimension's
// effects drawn from a normal with its own scale. Small groups borrow from the
// rest of the district (partial pooling); the fit is then reweighted to the
// people who actually live there (poststratification), so who happened to
// answer does not set the mix.
//
// The fit is the posterior mode (Newton), its uncertainty the Laplace
// approximation (a normal at the mode), and the estimates' ranges come from
// draws of that normal pushed through the frame. Fine at a district's size:
// a few dozen parameters and a few hundred cells.
//
// What the ranges do not hold: people who answer differing from neighbors
// like them who did not (responder bias), effects the additive model leaves
// out (interactions), doubt about the scales themselves, and a frame or
// labels that are wrong. See docs/features/civic-panel-mrp.md.

export interface MrpFrameCell {
  count: number
  values: Record<string, string>
}

// Answers from the people in one cell. A null value sits out that
// dimension (its effect reads as the dimension's mean, zero).
export interface MrpAnswerCell {
  yes: number
  answers: number
  values: Record<string, string | null>
}

// The prior scale (standard deviation, on the log-odds scale) of each
// dimension's effects: how far a group of that dimension can plausibly sit
// from the district. Learned from past questions by learnMrpScales.
export type MrpScales = Record<string, number>

export interface MrpOptions {
  interceptScale: number
  maxIterations: number
  tolerance: number
  draws: number
  // The central share of the draws a range holds: 0.9 is 5th to 95th.
  interval: number
  seed: number
}

export const DEFAULT_MRP_OPTIONS: MrpOptions = {
  interceptScale: 2,
  maxIterations: 50,
  tolerance: 1e-8,
  draws: 400,
  interval: 0.9,
  seed: 1,
}

// A scale for a dimension the caller gave none.
export const DEFAULT_MRP_SCALE = 0.5

export interface MrpParameter {
  dimension: string
  value: string
}

export interface MrpFit {
  parameters: MrpParameter[]
  coefficients: number[]
  covariance: number[][]
}

export interface MrpEstimate {
  mean: number
  low: number
  high: number
}

export interface MrpGroupEstimate extends MrpEstimate {
  dimension: string
  value: string
  share: number
  answers: number
}

export interface MrpResult {
  district: MrpEstimate
  groups: MrpGroupEstimate[]
}

const sigmoid = (x: number): number =>
  x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x))

// Every index below is in range by construction; the checker cannot see it.
const at = (values: readonly number[], i: number): number => values[i] ?? 0

const rowOf = (matrix: number[][], i: number): number[] => {
  const row = matrix[i]
  if (!row) throw new RangeError(`no row ${i}`)
  return row
}

// Needs a symmetric positive definite matrix, which a prior precision plus
// a sum of outer products always is.
const cholesky = (a: number[][]): number[][] => {
  const n = a.length
  const l = a.map(() => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    const li = rowOf(l, i)
    for (let j = 0; j <= i; j++) {
      const lj = rowOf(l, j)
      let sum = at(rowOf(a, i), j)
      for (let k = 0; k < j; k++) sum -= at(li, k) * at(lj, k)
      li[j] = i === j ? Math.sqrt(sum) : sum / at(lj, j)
    }
  }
  return l
}

const solveCholesky = (l: number[][], b: number[]): number[] => {
  const n = l.length
  const y = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    const li = rowOf(l, i)
    let sum = at(b, i)
    for (let k = 0; k < i; k++) sum -= at(li, k) * at(y, k)
    y[i] = sum / at(li, i)
  }
  const x = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let sum = at(y, i)
    for (let k = i + 1; k < n; k++) sum -= at(rowOf(l, k), i) * at(x, k)
    x[i] = sum / at(rowOf(l, i), i)
  }
  return x
}

const inverseCholesky = (l: number[][]): number[][] => {
  const n = l.length
  const columns = Array.from({ length: n }, (_, j) =>
    solveCholesky(
      l,
      Array.from({ length: n }, (_, i) => (i === j ? 1 : 0)),
    ),
  )
  return columns.map((_, i) => columns.map((column) => at(column, i)))
}

// Sorted, so the same frame always gives the same parameter order.
export const mrpParameters = (frame: MrpFrameCell[]): MrpParameter[] => {
  const seen = new Map<string, Set<string>>()
  for (const cell of frame) {
    for (const [dimension, value] of Object.entries(cell.values)) {
      const values = seen.get(dimension) ?? new Set<string>()
      values.add(value)
      seen.set(dimension, values)
    }
  }
  return [...seen.keys()]
    .sort()
    .flatMap((dimension) =>
      [...(seen.get(dimension) ?? [])]
        .sort()
        .map((value) => ({ dimension, value })),
    )
}

const keyOf = (dimension: string, value: string): string =>
  `${dimension}\u0000${value}`

// The parameter indexes a cell switches on, intercept (0) included. A value
// the frame does not hold switches nothing, like a null.
const indexesOf = (
  values: Record<string, string | null>,
  index: Map<string, number>,
): number[] => {
  const on = [0]
  for (const [dimension, value] of Object.entries(values)) {
    if (value == null) continue
    const i = index.get(keyOf(dimension, value))
    if (i !== undefined) on.push(i)
  }
  return on
}

const indexMap = (parameters: MrpParameter[]): Map<string, number> =>
  new Map(parameters.map((p, i) => [keyOf(p.dimension, p.value), i + 1]))

export const fitMrp = (
  answers: MrpAnswerCell[],
  frame: MrpFrameCell[],
  scales: MrpScales,
  options: Partial<MrpOptions> = {},
): MrpFit => {
  const { interceptScale, maxIterations, tolerance } = {
    ...DEFAULT_MRP_OPTIONS,
    ...options,
  }
  const parameters = mrpParameters(frame)
  const index = indexMap(parameters)
  const size = parameters.length + 1
  const priorVariance = [
    interceptScale ** 2,
    ...parameters.map((p) => (scales[p.dimension] ?? DEFAULT_MRP_SCALE) ** 2),
  ]
  const rows = answers
    .filter((cell) => cell.answers > 0)
    .map((cell) => ({ cell, on: indexesOf(cell.values, index) }))

  let beta = new Array<number>(size).fill(0)
  let factor: number[][] = []
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const gradient = beta.map((b, j) => -b / at(priorVariance, j))
    const hessian = priorVariance.map((v, i) =>
      priorVariance.map((_, j) => (i === j ? 1 / v : 0)),
    )
    for (const { cell, on } of rows) {
      const p = sigmoid(on.reduce((sum, j) => sum + at(beta, j), 0))
      const residual = cell.yes - cell.answers * p
      const weight = cell.answers * p * (1 - p)
      for (const i of on) {
        gradient[i] = at(gradient, i) + residual
        const row = rowOf(hessian, i)
        for (const j of on) row[j] = at(row, j) + weight
      }
    }
    factor = cholesky(hessian)
    const step = solveCholesky(factor, gradient)
    beta = beta.map((b, j) => b + at(step, j))
    if (Math.max(...step.map(Math.abs)) < tolerance) break
  }
  // The covariance at the mode: the Hessian of the last step, which the
  // converged step barely moved.
  return { parameters, coefficients: beta, covariance: inverseCholesky(factor) }
}

const uniforms = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const normals = (seed: number): (() => number) => {
  const next = uniforms(seed)
  return () => {
    const u = 1 - next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next())
  }
}

const summarize = (values: number[], interval: number): MrpEstimate => {
  const sorted = [...values].sort((a, b) => a - b)
  const quantile = (q: number): number =>
    at(
      sorted,
      Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length))),
    )
  const tail = (1 - interval) / 2
  return {
    mean: sorted.reduce((sum, v) => sum + v, 0) / sorted.length,
    low: quantile(tail),
    high: quantile(1 - tail),
  }
}

export const poststratify = (
  fit: MrpFit,
  frame: MrpFrameCell[],
  answers: MrpAnswerCell[],
  options: Partial<MrpOptions> = {},
): MrpResult => {
  const { draws, interval, seed } = { ...DEFAULT_MRP_OPTIONS, ...options }
  const index = indexMap(fit.parameters)
  const cells = frame.filter((cell) => cell.count > 0)
  const on = cells.map((cell) => indexesOf(cell.values, index))
  const total = cells.reduce((sum, cell) => sum + cell.count, 0)
  const groups = fit.parameters.map((p) => ({
    ...p,
    cells: cells.flatMap((cell, i) =>
      cell.values[p.dimension] === p.value ? [i] : [],
    ),
  }))
  const counts = cells.map((cell) => cell.count)
  const groupSize = groups.map((g) =>
    g.cells.reduce((sum, i) => sum + at(counts, i), 0),
  )

  const factor = cholesky(fit.covariance)
  const normal = normals(seed)
  const size = fit.coefficients.length
  const districtDraws: number[] = []
  const groupDraws = groups.map(() => [] as number[])
  for (let d = 0; d < draws; d++) {
    const z = Array.from({ length: size }, normal)
    const beta = fit.coefficients.map(
      (b, i) =>
        b + rowOf(factor, i).reduce((sum, l, k) => sum + l * at(z, k), 0),
    )
    const probability = on.map((idx) =>
      sigmoid(idx.reduce((sum, j) => sum + at(beta, j), 0)),
    )
    districtDraws.push(
      counts.reduce((sum, n, i) => sum + n * at(probability, i), 0) / total,
    )
    groups.forEach((g, k) => {
      const size = at(groupSize, k)
      if (size === 0) return
      groupDraws[k]?.push(
        g.cells.reduce(
          (sum, i) => sum + at(counts, i) * at(probability, i),
          0,
        ) / size,
      )
    })
  }

  return {
    district: summarize(districtDraws, interval),
    groups: groups.flatMap((g, k) =>
      at(groupSize, k) === 0
        ? []
        : [
            {
              dimension: g.dimension,
              value: g.value,
              share: at(groupSize, k) / total,
              answers: answers.reduce(
                (sum, cell) =>
                  cell.values[g.dimension] === g.value
                    ? sum + cell.answers
                    : sum,
                0,
              ),
              ...summarize(groupDraws[k] ?? [], interval),
            },
          ],
    ),
  }
}

export const estimateMrp = (
  answers: MrpAnswerCell[],
  frame: MrpFrameCell[],
  scales: MrpScales,
  options: Partial<MrpOptions> = {},
): MrpResult =>
  poststratify(fitMrp(answers, frame, scales, options), frame, answers, options)

export interface MrpScaleOptions {
  iterations: number
  // Learned scales stay within these bounds, so one odd question cannot
  // switch a dimension off or let it swing every estimate.
  minScale: number
  maxScale: number
  startScale: number
}

export const DEFAULT_MRP_SCALE_OPTIONS: MrpScaleOptions = {
  iterations: 12,
  minScale: 0.1,
  maxScale: 1.5,
  startScale: DEFAULT_MRP_SCALE,
}

// How much each dimension has mattered across past questions (empirical
// Bayes, by expectation maximization): refit every question with the
// current scales, then set each dimension's scale to the root of its
// effects' mean posterior second moment. A dimension that keeps splitting
// opinion grows; one that never does shrinks, so its groups pool harder.
// With no past questions every dimension keeps the start scale.
export const learnMrpScales = (
  past: MrpAnswerCell[][],
  frame: MrpFrameCell[],
  options: Partial<MrpScaleOptions & MrpOptions> = {},
): MrpScales => {
  const { iterations, minScale, maxScale, startScale } = {
    ...DEFAULT_MRP_SCALE_OPTIONS,
    ...options,
  }
  const dimensions = [...new Set(mrpParameters(frame).map((p) => p.dimension))]
  let scales: MrpScales = Object.fromEntries(
    dimensions.map((d) => [d, startScale]),
  )
  if (past.length === 0) return scales
  for (let iteration = 0; iteration < iterations; iteration++) {
    const moment = new Map<string, { sum: number; count: number }>()
    for (const answers of past) {
      const fit = fitMrp(answers, frame, scales, options)
      fit.parameters.forEach((p, i) => {
        const j = i + 1
        const m = moment.get(p.dimension) ?? { sum: 0, count: 0 }
        m.sum += at(fit.coefficients, j) ** 2 + at(rowOf(fit.covariance, j), j)
        m.count += 1
        moment.set(p.dimension, m)
      })
    }
    scales = Object.fromEntries(
      dimensions.map((d) => {
        const m = moment.get(d)
        const scale = m ? Math.sqrt(m.sum / m.count) : startScale
        return [d, Math.min(maxScale, Math.max(minScale, scale))]
      }),
    )
  }
  return scales
}
