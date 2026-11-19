import { describe, expect, it } from 'vitest'
import { generateTestUserData, uniquePhone } from './identifiers'

describe('generateTestUserData', () => {
  it('generates a test user gp-api sweeps', () => {
    const data = generateTestUserData()
    expect(data.email).toMatch(/^test-.+\+clerk_test@test\.goodparty\.org$/)
  })

  it('generates a different identity every call', () => {
    const first = generateTestUserData()
    const second = generateTestUserData()
    expect(first.email).not.toBe(second.email)
  })
})

describe('uniquePhone', () => {
  it('generates a fictional NANP number', () => {
    expect(uniquePhone()).toMatch(/^[2-9]\d{2}55501\d{2}$/)
  })

  it('never repeats within a process', () => {
    const phones = Array.from({ length: 50 }, () => uniquePhone())
    expect(new Set(phones).size).toBe(phones.length)
  })
})
