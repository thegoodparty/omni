import { describe, it, expect } from 'vitest'
import { camelToSentence, kebabToCamel, camelToKebab } from './stringHelper'

describe('camelToSentence', () => {
  it('splits camelCase into space-separated words and capitalizes the first letter', () => {
    expect(camelToSentence('camelCase')).toBe('Camel Case')
    expect(camelToSentence('helloWorld')).toBe('Hello World')
  })

  it('capitalizes a single lowercase word', () => {
    expect(camelToSentence('hello')).toBe('Hello')
    expect(camelToSentence('a')).toBe('A')
  })

  it('handles multiple consecutive capitals by prefixing each with a space', () => {
    expect(camelToSentence('myURLValue')).toBe('My U R L Value')
  })

  it('returns an empty string when given an empty string', () => {
    expect(camelToSentence('')).toBe('')
  })
})

describe('kebabToCamel', () => {
  it('converts kebab-case to camelCase', () => {
    expect(kebabToCamel('hello-world')).toBe('helloWorld')
    expect(kebabToCamel('foo-bar-baz')).toBe('fooBarBaz')
    expect(kebabToCamel('a-b-c')).toBe('aBC')
  })

  it('leaves strings without dashes unchanged', () => {
    expect(kebabToCamel('nodash')).toBe('nodash')
  })

  it('returns an empty string for null, undefined, or empty input', () => {
    expect(kebabToCamel(null)).toBe('')
    expect(kebabToCamel(undefined)).toBe('')
    expect(kebabToCamel('')).toBe('')
  })
})

describe('camelToKebab', () => {
  it('converts camelCase to kebab-case', () => {
    expect(camelToKebab('helloWorld')).toBe('hello-world')
    expect(camelToKebab('fooBarBaz')).toBe('foo-bar-baz')
    expect(camelToKebab('camelCase')).toBe('camel-case')
  })

  it('lowercases input that has no boundaries to split', () => {
    expect(camelToKebab('nodash')).toBe('nodash')
    expect(camelToKebab('ALLCAPS')).toBe('allcaps')
  })

  it('splits on digit-to-uppercase boundaries', () => {
    expect(camelToKebab('item1Value')).toBe('item1-value')
  })

  it('returns an empty string for null, undefined, or empty input', () => {
    expect(camelToKebab(null)).toBe('')
    expect(camelToKebab(undefined)).toBe('')
    expect(camelToKebab('')).toBe('')
  })
})
