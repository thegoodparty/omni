import { describe, it, expect } from 'vitest'
import { isObjectEqual, pick } from './objectHelper'

describe('isObjectEqual', () => {
  it('compares primitives by strict equality', () => {
    expect(isObjectEqual(1, 1)).toBe(true)
    expect(isObjectEqual(1, 2)).toBe(false)
    expect(isObjectEqual('a', 'a')).toBe(true)
    expect(isObjectEqual('a', 'b')).toBe(false)
  })

  it('treats null and undefined via strict equality', () => {
    expect(isObjectEqual(null, null)).toBe(true)
    expect(isObjectEqual(undefined, undefined)).toBe(true)
    expect(isObjectEqual(null, undefined)).toBe(false)
  })

  it('compares flat objects by their keys and values', () => {
    expect(isObjectEqual({ a: 1 }, { a: 1 })).toBe(true)
    expect(isObjectEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(isObjectEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false)
    expect(isObjectEqual({ a: 1 }, { b: 1 })).toBe(false)
  })

  it('returns true when comparing an object to itself', () => {
    const obj = { a: { b: 1 } }
    expect(isObjectEqual(obj, obj)).toBe(true)
  })

  it('only inspects nested objects when deepCompare is enabled', () => {
    expect(isObjectEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(false)
    expect(isObjectEqual({ a: { b: 1 } }, { a: { b: 1 } }, true)).toBe(true)
    expect(isObjectEqual({ a: { b: 1 } }, { a: { b: 2 } }, true)).toBe(false)
  })

  it('compares arrays by index', () => {
    expect(isObjectEqual([1, 2], [1, 2])).toBe(true)
    expect(isObjectEqual([1, 2], [1, 3])).toBe(false)
  })
})

describe('pick', () => {
  it('returns a new object with only the requested keys', () => {
    expect(pick({ a: 1, b: 2, c: 3 }, ['a', 'c'])).toEqual({ a: 1, c: 3 })
  })

  it('ignores keys that are not present on the object', () => {
    expect(
      pick({ a: 1, b: 2 }, ['a', 'z'] as (keyof { a: number; b: number })[]),
    ).toEqual({ a: 1 })
  })

  it('returns an empty object when no keys are requested', () => {
    expect(pick({ a: 1 }, [])).toEqual({})
  })

  it('throws when obj is not a non-null object', () => {
    expect(() =>
      pick(null as unknown as Record<string, number>, ['a']),
    ).toThrow('invalid args')
    expect(() =>
      pick('str' as unknown as Record<string, number>, ['length']),
    ).toThrow('invalid args')
  })

  it('throws when keys is not an array', () => {
    expect(() =>
      pick({ a: 1 }, 'a' as unknown as (keyof { a: number })[]),
    ).toThrow('invalid args')
  })
})
