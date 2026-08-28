import { describe, it, expect } from 'vitest'
import { isProductRoute } from './isProductRoute'

describe('isProductRoute', () => {
  it('treats the win onboarding flow as a product route', () => {
    expect(isProductRoute('/onboarding')).toBe(true)
    expect(isProductRoute('/onboarding/office-selection')).toBe(true)
  })

  it('treats the elected-official (serve) flow as a product route', () => {
    // Suppresses the global site footer on the focused full-screen serve flow.
    expect(isProductRoute('/serve')).toBe(true)
    expect(isProductRoute('/serve/welcome')).toBe(true)
    expect(isProductRoute('/serve/onboarding')).toBe(true)
  })

  it('treats the one-time sign-in link page as a product route', () => {
    // Same focused full-screen chrome as /serve/welcome, so the global
    // marketing footer must not stack under it.
    expect(isProductRoute('/sign-in-link')).toBe(true)
  })

  it('treats dashboard, polls, and profile as product routes', () => {
    expect(isProductRoute('/dashboard')).toBe(true)
    expect(isProductRoute('/dashboard/profile')).toBe(true)
    expect(isProductRoute('/polls')).toBe(true)
  })

  it('keeps marketing/other routes non-product (global footer renders)', () => {
    expect(isProductRoute('/')).toBe(false)
    expect(isProductRoute('/login')).toBe(false)
    expect(isProductRoute('/elections')).toBe(false)
    expect(isProductRoute('/candidates')).toBe(false)
  })

  it('handles nullish pathnames', () => {
    expect(isProductRoute(null)).toBe(false)
    expect(isProductRoute(undefined)).toBe(false)
  })
})
