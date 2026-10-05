import { describe, expect, it } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  DASHBOARD_ROUTE_SEGMENTS,
  NON_DASHBOARD_ROUTE_PREFIXES,
  isDashboardRoute,
} from './dashboardRoutes'

const APP_DIR = path.resolve(__dirname, '../..')
const GROUP_DIR = path.join(APP_DIR, '(dashboard)')
const ROUTE_FILES = new Set(['page.tsx', 'route.ts'])

const hasRoute = (dir: string): boolean =>
  readdirSync(dir).some((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? hasRoute(full) : ROUTE_FILES.has(name)
  })

const routeDirs = (dir: string): string[] =>
  readdirSync(dir).filter((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() && hasRoute(full)
  })

const routePaths = (dir: string, prefix: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (!statSync(full).isDirectory()) return []
    const here = `${prefix}/${name}`
    const own = readdirSync(full).some((f) => ROUTE_FILES.has(f)) ? [here] : []
    return [...own, ...routePaths(full, here)]
  })

describe('DASHBOARD_ROUTE_SEGMENTS', () => {
  it('lists exactly the top-level route folders in app/(dashboard)', () => {
    expect([...DASHBOARD_ROUTE_SEGMENTS].sort()).toEqual(
      routeDirs(GROUP_DIR).sort(),
    )
  })

  it('carves out every route outside the group that shares a segment', () => {
    const shared = DASHBOARD_ROUTE_SEGMENTS.filter((segment) =>
      routeDirs(APP_DIR).includes(segment),
    )
    const outside = shared.flatMap((segment) =>
      routePaths(path.join(APP_DIR, segment), `/${segment}`),
    )
    for (const route of outside) {
      expect(isDashboardRoute(route)).toBe(false)
    }
    expect(outside.length).toBeGreaterThan(0)
  })
})

describe('isDashboardRoute', () => {
  it('matches dashboard pages and their sub-paths', () => {
    expect(isDashboardRoute('/home')).toBe(true)
    expect(isDashboardRoute('/outreach/phone-banking/5')).toBe(true)
    expect(isDashboardRoute('/polls/42/expand')).toBe(true)
  })

  it('ignores query strings and hashes', () => {
    expect(isDashboardRoute('/home?personalize=1')).toBe(true)
    expect(isDashboardRoute('/briefings#section')).toBe(true)
  })

  it('does not match routes outside the dashboard', () => {
    expect(isDashboardRoute('/')).toBe(false)
    expect(isDashboardRoute('/login')).toBe(false)
    expect(isDashboardRoute('/onboarding/office-selection')).toBe(false)
    expect(isDashboardRoute('/volunteer')).toBe(false)
    expect(isDashboardRoute('/serve/onboarding')).toBe(false)
    expect(isDashboardRoute('/pollsters')).toBe(false)
    for (const prefix of NON_DASHBOARD_ROUTE_PREFIXES) {
      expect(isDashboardRoute(prefix)).toBe(false)
    }
  })

  it('handles a missing pathname', () => {
    expect(isDashboardRoute(null)).toBe(false)
    expect(isDashboardRoute(undefined)).toBe(false)
  })
})
