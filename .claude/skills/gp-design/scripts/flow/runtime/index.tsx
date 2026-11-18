// gp-flow: what a flow file imports besides react and the styleguide.
// A flow file (assets/flow-template.tsx) exports:
//   screens: { entry: () => <...>, '1': () => <...> }  the clickable flow; entry is where the user starts
//   states:  { 'upload-failed': { label: 'The file has no phone column', screen: () => <...>, values: { color: 'blue' } } }
//            Other states; values (optional) seeds useFlowState for that state
//   products (optional): ['serve', 'win'] when the ticket names both; the page shows a Serve / Win switch
// Any element with data-go="<screen key>" opens that screen when clicked.
// useFlowState(key, initial) keeps a choice across screens (a picked color, a removed
// photo); Restart clears it, and each state starts from its own values.
import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  type ReactNode,
} from 'react'

export type Product = 'win' | 'serve'
export type Screen = () => ReactNode
export type Screens = { entry: Screen } & Record<string, Screen>
export type FlowValues = Record<string, unknown>
export type States = Record<
  string,
  { label: string; screen: Screen; values?: FlowValues }
>
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

type Store = { values: FlowValues; listeners: Set<() => void> }
export const makeStore = (values: FlowValues = {}): Store => ({
  values: { ...values },
  listeners: new Set(),
})
export const StoreContext = createContext<Store>(makeStore())

// A value every screen of this flow shares, like useState across data-go steps.
export const useFlowState = <T,>(key: string, initial: T) => {
  const store = useContext(StoreContext)
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    store.listeners.add(rerender)
    return () => {
      store.listeners.delete(rerender)
    }
  }, [store])
  const value = (key in store.values ? store.values[key] : initial) as T
  const set = (next: T) => {
    store.values[key] = next
    store.listeners.forEach((l) => l())
  }
  return [value, set] as const
}
