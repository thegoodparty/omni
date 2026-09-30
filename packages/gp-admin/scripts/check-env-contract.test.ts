import { describe, expect, it } from 'vitest'
import { EnvVarSpec } from '../env.schema'
import { checkEnvContract, parseEnvExample } from './check-env-contract'

describe('parseEnvExample', () => {
  it('ignores comments and blank lines', () => {
    const parsed = parseEnvExample(
      ['# a comment', '', 'FOO=bar', '  ', '# FOO=commented-out'].join('\n')
    )

    expect(parsed).toEqual({ FOO: 'bar' })
  })

  it('reads an empty value', () => {
    const parsed = parseEnvExample('FOO=')

    expect(parsed).toEqual({ FOO: '' })
  })

  it('strips a double-quoted value', () => {
    const parsed = parseEnvExample('FOO="bar baz"')

    expect(parsed).toEqual({ FOO: 'bar baz' })
  })
})

describe('checkEnvContract', () => {
  const contract: Record<string, EnvVarSpec> = {
    REQUIRED_VAR: { tier: 'required' },
    OPTIONAL_VAR: { tier: 'optional' },
  }

  it('passes when both sides match and required vars have a value', () => {
    const errors = checkEnvContract(
      { REQUIRED_VAR: 'x', OPTIONAL_VAR: '' },
      contract
    )

    expect(errors).toEqual([])
  })

  it('reports a key present in .env.example but not the schema', () => {
    const errors = checkEnvContract(
      { REQUIRED_VAR: 'x', OPTIONAL_VAR: '', UNDOCUMENTED_VAR: 'x' },
      contract
    )

    expect(errors.join('\n')).toContain('UNDOCUMENTED_VAR')
    expect(errors.join('\n')).toContain('missing from env.schema.ts')
  })

  it('reports a schema var missing from .env.example', () => {
    const errors = checkEnvContract({ REQUIRED_VAR: 'x' }, contract)

    expect(errors.join('\n')).toContain('OPTIONAL_VAR')
    expect(errors.join('\n')).toContain('missing from .env.example')
  })

  it('reports a required var with no value in .env.example', () => {
    const errors = checkEnvContract(
      { REQUIRED_VAR: '', OPTIONAL_VAR: '' },
      contract
    )

    expect(errors.join('\n')).toContain('REQUIRED_VAR')
    expect(errors.join('\n')).toContain('no value in .env.example')
  })
})
