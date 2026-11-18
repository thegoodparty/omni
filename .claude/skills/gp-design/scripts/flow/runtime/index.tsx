// gp-flow: what a flow file imports besides react and the styleguide.
// A flow file (assets/flow-template.tsx) exports:
//   screens: { entry: () => <...>, '1': () => <...> }  the clickable flow; entry is where the user starts
//   states:  { 'upload-failed': { label: 'The file has no phone column', screen: () => <...> } }  Other states
//   products (optional): ['serve', 'win'] when the ticket names both; the page shows a Serve / Win switch
// Any element with data-go="<screen key>" opens that screen when clicked.
import { createContext, useContext, type ReactNode } from 'react'

export type Product = 'win' | 'serve'
export type Screen = () => ReactNode
export type Screens = { entry: Screen } & Record<string, Screen>
export type States = Record<string, { label: string; screen: Screen }>
export type FlowModule = {
  screens: Screens
  states?: States
  products?: Product[]
}

export const ProductContext = createContext<Product>('serve')
export const GoContext = createContext<(step: string) => void>(() => {})

// The product the page's switch shows. Keep one copy object per product, the way the product does.
export const useProduct = () => useContext(ProductContext)

// Open a screen from code, for a step that moves on by itself (an upload that finishes).
export const useGo = () => useContext(GoContext)
