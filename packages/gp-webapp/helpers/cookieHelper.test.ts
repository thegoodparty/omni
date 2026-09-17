import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getCookie,
  setCookie,
  deleteCookie,
  deleteCookies,
} from './cookieHelper'

const stubProtocol = (protocol: string) => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, protocol },
  })
}

const clearCookies = () => {
  document.cookie.split(';').forEach((c) => {
    document.cookie = c
      .replace(/^ +/, '')
      .replace(/=.*/, '=;expires=Thu, 01 Jan 1970 00:00:01 GMT;path=/')
  })
}

describe('cookieHelper', () => {
  beforeEach(() => {
    clearCookies()
  })

  it('getCookie returns false when cookie does not exist', () => {
    expect(getCookie('nonexistent')).toBe(false)
  })

  it('getCookie returns value when cookie exists', () => {
    document.cookie = 'testCookie=hello'
    expect(getCookie('testCookie')).toBe('hello')
  })

  it('setCookie sets a cookie that can be retrieved', () => {
    setCookie('myCookie', 'myValue')
    expect(getCookie('myCookie')).toBe('myValue')
  })

  it('deleteCookie removes a cookie', () => {
    setCookie('toDelete', 'value')
    deleteCookie('toDelete')
    expect(getCookie('toDelete')).toBe(false)
  })

  it('deleteCookie expires the cookie at the path setCookie wrote it to', () => {
    // A cookie is identified by name AND path. setCookie always writes
    // `path=/`, so an expiry without it targets a different cookie and expires
    // nothing — which only showed up away from "/", since the document path is
    // "/" in these tests and in a naive manual check.
    const setter = vi.spyOn(document, 'cookie', 'set')

    deleteCookie('scoped')

    expect(setter).toHaveBeenCalledTimes(1)
    const written = setter.mock.calls[0]![0] as string
    expect(written).toContain('path=/')
    expect(written).toContain('expires=Thu, 01 Jan 1970 00:00:01 GMT')
    setter.mockRestore()
  })

  it('deleteCookie clears a path=/ cookie from a nested page', () => {
    // The real case: an admin ending an impersonation session is somewhere
    // under /dashboard, not at the site root.
    window.history.pushState({}, '', '/dashboard/chief-of-staff')
    setCookie('nested', 'value')
    expect(getCookie('nested')).toBe('value')

    deleteCookie('nested')

    expect(getCookie('nested')).toBe(false)
    // Gone outright, not standing as an empty-valued session cookie.
    expect(document.cookie).not.toContain('nested')
    window.history.pushState({}, '', '/')
  })

  it('deleteCookies clears all cookies', () => {
    setCookie('a', '1')
    setCookie('b', '2')
    deleteCookies()
    expect(getCookie('a')).toBe(false)
    expect(getCookie('b')).toBe(false)
  })

  describe('Secure flag', () => {
    const originalLocation = window.location

    afterEach(() => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      })
    })

    it('appends Secure when the page is https', () => {
      stubProtocol('https:')
      const setter = vi.spyOn(document, 'cookie', 'set')

      setCookie('secureCookie', 'value')

      expect(setter).toHaveBeenCalledWith(expect.stringContaining('; Secure'))
    })

    it('omits Secure when the page is http', () => {
      stubProtocol('http:')
      const setter = vi.spyOn(document, 'cookie', 'set')

      setCookie('insecureCookie', 'value')

      expect(setter).toHaveBeenCalledWith(
        expect.not.stringContaining('; Secure'),
      )
    })
  })
})
