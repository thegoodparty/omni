export type JudgeCliOptions = {
  base: string
  candidate: string
  // Suite names, or 'all'.
  suite: string
  judgeModel: string
  out: string
  concurrency: number
}

const DEFAULT_CONCURRENCY = 16

const FLAGS = [
  'base',
  'candidate',
  'suite',
  'judge-model',
  'out',
  'concurrency',
] as const

export const USAGE = `usage: npx tsx packages/judge/src/run.ts \\
  --base <url> \\
  --candidate <url> \\
  --suite <names|all> \\
  --judge-model <ai-sdk model id e.g. anthropic/claude-sonnet-5-5> \\
  --out <dir> \\
  [--concurrency ${DEFAULT_CONCURRENCY}]`

export class JudgeCliError extends Error {}

const requireValue = (flag: string, value: string | undefined): string => {
  if (value === undefined || value === '' || value.startsWith('--')) {
    throw new JudgeCliError(`--${flag} needs a value`)
  }
  return value
}

const requireUrl = (flag: string, value: string): string => {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new JudgeCliError(`--${flag} must be an absolute URL, got '${value}'`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new JudgeCliError(`--${flag} must be http or https, got '${value}'`)
  }
  return value.replace(/\/$/, '')
}

export const parseJudgeCliArgs = (argv: readonly string[]): JudgeCliOptions => {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!
    if (argument === '--help' || argument === '-h') {
      throw new JudgeCliError(USAGE)
    }
    if (!argument.startsWith('--')) {
      throw new JudgeCliError(`Unexpected argument '${argument}'`)
    }
    const [rawFlag, inlineValue] = argument.slice(2).split('=')
    const flag = rawFlag!
    if (!FLAGS.includes(flag as (typeof FLAGS)[number])) {
      throw new JudgeCliError(`Unknown flag '--${flag}'`)
    }
    if (values.has(flag)) {
      throw new JudgeCliError(`--${flag} was given more than once`)
    }
    const value =
      inlineValue !== undefined
        ? inlineValue
        : requireValue(flag, argv[index + 1])
    if (inlineValue === undefined) index += 1
    values.set(flag, value)
  }

  const base = requireUrl('base', requireValue('base', values.get('base')))
  const candidate = requireUrl(
    'candidate',
    requireValue('candidate', values.get('candidate')),
  )
  if (base === candidate) {
    throw new JudgeCliError(
      '--base and --candidate are the same URL, so every pair would compare an arm with itself',
    )
  }
  const suite = requireValue('suite', values.get('suite'))
  if (suite !== 'all' && suite.split(',').every((name) => !name.trim())) {
    throw new JudgeCliError('--suite needs suite names, or all')
  }
  const judgeModel = requireValue('judge-model', values.get('judge-model'))
  const out = requireValue('out', values.get('out'))

  const rawConcurrency = values.get('concurrency')
  const concurrency =
    rawConcurrency === undefined ? DEFAULT_CONCURRENCY : Number(rawConcurrency)
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new JudgeCliError(
      `--concurrency must be a whole number of at least 1, got '${rawConcurrency}'`,
    )
  }

  return { base, candidate, suite, judgeModel, out, concurrency }
}

export const selectedSuiteNames = (suite: string): 'all' | string[] =>
  suite === 'all'
    ? 'all'
    : suite
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '')
