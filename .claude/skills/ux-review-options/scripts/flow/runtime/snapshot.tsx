// Build-time snapshot of every screen and state as static HTML, at phone width, for
// check.py's copy and markup scans. Overlays render in place (portal.tsx). With both
// products, the Win copy renders inside data-product="win" so the Serve vocabulary
// check skips it.
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentType } from 'react'
import { StaticFrame } from './frame'
import {
  GoContext,
  ProductContext,
  type FlowModule,
  type Product,
} from './index'

const render = (Screen: ComponentType, product: Product) =>
  renderToStaticMarkup(
    <ProductContext.Provider value={product}>
      <GoContext.Provider value={() => {}}>
        <StaticFrame width={375}>
          <Screen />
        </StaticFrame>
      </GoContext.Provider>
    </ProductContext.Provider>,
  )

const both = (Screen: ComponentType, products: Product[]) =>
  products
    .map((p) =>
      p === 'win' && products.length > 1
        ? `<div data-product="win">${render(Screen, p)}</div>`
        : render(Screen, p),
    )
    .join('')

export const snapshot = (flows: Record<string, FlowModule>) => {
  const out: Record<
    string,
    {
      screens: Record<string, string>
      states: Record<string, { label: string; html: string }>
    }
  > = {}
  for (const [oid, flow] of Object.entries(flows)) {
    const products = flow.products?.length
      ? flow.products
      : (['serve'] as Product[])
    out[oid] = { screens: {}, states: {} }
    for (const [step, screen] of Object.entries(flow.screens)) {
      out[oid].screens[step] = both(screen as ComponentType, products)
    }
    for (const [id, s] of Object.entries(flow.states ?? {})) {
      out[oid].states[id] = {
        label: s.label,
        html: both(s.screen as ComponentType, products),
      }
    }
  }
  return out
}
