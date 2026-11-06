import { describe, expect, it } from 'vitest'
import { importContactsHref, safeImportReturnTo } from './importContactsCopy'

describe('safeImportReturnTo', () => {
  it('keeps a dashboard path with its query', () => {
    expect(safeImportReturnTo('/dashboard/outreach/email?imported=1')).toBe(
      '/dashboard/outreach/email?imported=1',
    )
    expect(
      safeImportReturnTo('/dashboard/constituent-outreach?compose=email'),
    ).toBe('/dashboard/constituent-outreach?compose=email')
  })

  it.each([
    null,
    undefined,
    '',
    'https://evil.example/dashboard/x',
    '//evil.example/dashboard/x',
    '/\\evil.example/dashboard/x',
    'javascript:alert(1)',
    '/login',
    '/dashboardx/outreach',
    '/dashboard/../login',
  ])('refuses %s', (raw) => {
    expect(safeImportReturnTo(raw)).toBeNull()
  })

  it('round-trips through the import link', () => {
    const href = importContactsHref('/dashboard/outreach/email?imported=1')
    const params = new URL(href, 'https://goodparty.org').searchParams
    expect(params.get('import')).toBe('1')
    expect(safeImportReturnTo(params.get('returnTo'))).toBe(
      '/dashboard/outreach/email?imported=1',
    )
  })
})
