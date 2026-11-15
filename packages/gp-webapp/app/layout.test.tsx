import { describe, expect, it, vi } from 'vitest'
import { isValidElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import RootLayout from './layout'

const mockPathname = vi.hoisted(() => ({ value: null as string | null }))
vi.mock('@shared/utils/getReqPathname', () => ({
  getReqPathname: async () => mockPathname.value,
}))
vi.mock('./fonts', () => ({
  openSans: { variable: 'open-sans' },
  outfit: { variable: 'outfit' },
}))
vi.mock('./shared/layouts/PageWrapper', () => ({
  default: function PageWrapper() {
    return null
  },
}))
vi.mock('@shared/scripts/RouteTrackerScript', () => ({
  default: function RouteTracker() {
    return null
  },
}))
vi.mock('@shared/AnalyticsSessionReplayMiddleware', () => ({
  default: function AnalyticsSessionReplayMiddleware() {
    return null
  },
}))
vi.mock('@shared/AppServiceWorker', () => ({
  default: function AppServiceWorker() {
    return null
  },
}))

const TRACKERS = [
  'vwoCode',
  'id="gtm"',
  'googletagmanager',
  'hs-script-loader',
  'js.hs-scripts.com',
]

const names = (node: ReactNode, out: string[] = []): string[] => {
  if (Array.isArray(node)) node.forEach((n) => names(n, out))
  else if (isValidElement<{ children?: ReactNode }>(node)) {
    if (typeof node.type === 'function') out.push(node.type.name)
    names(node.props.children, out)
  }
  return out
}

const renderLayout = async (pathname: string) => {
  mockPathname.value = pathname
  const outer = await RootLayout({ children: <p>page</p> })
  const inner = (outer.type as (props: unknown) => ReactNode)(outer.props)
  return { tree: outer, names: names(inner) }
}

describe('RootLayout', () => {
  it('loads no tracker, analytics or replay on /email pages', async () => {
    const { tree, names: used } = await renderLayout(
      '/email/unsubscribe/abc.def',
    )
    const html = renderToStaticMarkup(tree)
    TRACKERS.forEach((t) => expect(html).not.toContain(t))
    expect(html).toContain('<p>page</p>')
    expect(used).not.toContain('VwoScript')
    expect(used).not.toContain('RouteTracker')
    expect(used).not.toContain('AnalyticsSessionReplayMiddleware')
    expect(used).not.toContain('PageWrapper')
  })

  it('still loads the trackers elsewhere', async () => {
    const { names: used } = await renderLayout('/dashboard')
    expect(used).toEqual(
      expect.arrayContaining(['VwoScript', 'RouteTracker', 'PageWrapper']),
    )
  })
})
