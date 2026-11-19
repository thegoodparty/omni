import { describe, expect, it } from 'vitest'
import { JudgeCliError, parseJudgeCliArgs, selectedSuiteNames } from './cli'

const argv = [
  '--base',
  'https://dev.goodparty.org',
  '--candidate',
  'https://pr-1.preview.goodparty.org',
  '--suite',
  'trending_issues',
  '--judge-model',
  'anthropic/claude-sonnet-4-6',
  '--out',
  './judge-results',
]

describe('parseJudgeCliArgs', () => {
  it('reads every flag', () => {
    expect(parseJudgeCliArgs(argv)).toEqual({
      base: 'https://dev.goodparty.org',
      candidate: 'https://pr-1.preview.goodparty.org',
      suite: 'trending_issues',
      judgeModel: 'anthropic/claude-sonnet-4-6',
      out: './judge-results',
      concurrency: 16,
    })
  })

  it('reads --flag=value form', () => {
    const options = parseJudgeCliArgs([
      '--base=https://dev.goodparty.org',
      '--candidate=https://pr-1.preview.goodparty.org',
      '--suite=all',
      '--judge-model=anthropic/claude-sonnet-4-6',
      '--out=./out',
      '--concurrency=4',
    ])
    expect(options.concurrency).toBe(4)
    expect(options.suite).toBe('all')
  })

  it('strips a trailing slash so two spellings of one URL compare equal', () => {
    const options = parseJudgeCliArgs([
      '--base',
      'https://dev.goodparty.org/',
      '--candidate',
      'https://pr-1.preview.goodparty.org',
      '--suite',
      'all',
      '--judge-model',
      'anthropic/claude-sonnet-4-6',
      '--out',
      './out',
    ])
    expect(options.base).toBe('https://dev.goodparty.org')
  })

  it('refuses identical arms, however each is spelled', () => {
    expect(() =>
      parseJudgeCliArgs([
        '--base',
        'https://dev.goodparty.org',
        '--candidate',
        'https://dev.goodparty.org/',
        '--suite',
        'all',
        '--judge-model',
        'anthropic/claude-sonnet-4-6',
        '--out',
        './out',
      ]),
    ).toThrow(/same URL/)
  })

  it('requires every flag', () => {
    for (let index = 0; index < argv.length; index += 2) {
      const withoutFlag = [...argv.slice(0, index), ...argv.slice(index + 2)]
      expect(() => parseJudgeCliArgs(withoutFlag)).toThrow(JudgeCliError)
    }
  })

  it('rejects a flag with no value', () => {
    expect(() => parseJudgeCliArgs([...argv, '--concurrency'])).toThrow(
      /--concurrency needs a value/,
    )
  })

  it('rejects an unknown flag', () => {
    expect(() => parseJudgeCliArgs([...argv, '--verbose', '1'])).toThrow(
      /Unknown flag '--verbose'/,
    )
  })

  it('rejects a repeated flag', () => {
    expect(() => parseJudgeCliArgs([...argv, '--out', './two'])).toThrow(
      /more than once/,
    )
  })

  it('rejects a positional argument', () => {
    expect(() => parseJudgeCliArgs(['flying', ...argv])).toThrow(
      /Unexpected argument/,
    )
  })

  it('rejects a base that is not an absolute URL', () => {
    expect(() =>
      parseJudgeCliArgs(['--base', 'dev.goodparty.org', ...argv.slice(2)]),
    ).toThrow(/absolute URL/)
  })

  it('rejects a non-http scheme', () => {
    expect(() =>
      parseJudgeCliArgs([
        '--base',
        'ftp://dev.goodparty.org',
        ...argv.slice(2),
      ]),
    ).toThrow(/http or https/)
  })

  it('rejects a concurrency that is not a whole number', () => {
    expect(() => parseJudgeCliArgs([...argv, '--concurrency', '1.5'])).toThrow(
      /whole number/,
    )
    expect(() => parseJudgeCliArgs([...argv, '--concurrency', '0'])).toThrow(
      /whole number/,
    )
  })
})

describe('selectedSuiteNames', () => {
  it('passes all through', () => {
    expect(selectedSuiteNames('all')).toBe('all')
  })

  it('splits and trims a list, dropping empties', () => {
    expect(selectedSuiteNames(' a, b ,,c ')).toEqual(['a', 'b', 'c'])
  })
})
