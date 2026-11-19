// Mounts each option's flow on the review page, or one flow alone in ?view= mode.
// Page: [data-gp-head="option-a"] gets Restart, Desktop preview, Show how it's built when
// the option has a build shape, and, with both products, the Serve / Win switch; [data-gp-flow="option-a"] gets the phone frame;
// [data-gp-states="option-a"] gets Other states. Any [data-go] outside a frame drives
// the flow of the option it sits in.
// ?view=phone|desktop[&option=b][&step=2|&state=upload-failed] shows one frame alone at
// the window's size, for the Desktop preview tab and for screenshots.
// ?view=build[&option=b] shows the option's build shape alone, for the Show how it's built tab.
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { Button } from '@styleguide/components/ui/button'
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@styleguide/components/ui/toggle-group'
import { Frame } from './frame'
import {
  GoContext,
  ProductContext,
  StoreContext,
  makeStore,
  type FlowModule,
  type Product,
} from './index'

const controllers: Record<string, (step: string) => void> = {}
const restarts: Record<string, () => void> = {}

// With no products export, the flow is the page's one product: <main data-product>.
const pageProduct = (): Product =>
  document.querySelector('main')?.getAttribute('data-product') === 'win'
    ? 'win'
    : 'serve'

const Missing = ({ what }: { what: string }) => (
  <p className="p-6 text-destructive">No screen "{what}" in this flow.</p>
)

const Navigator = ({
  oid,
  flow,
  initial,
}: {
  oid: string
  flow: FlowModule
  initial: string
}) => {
  // visit changes on every go(), so going to the screen already showing starts it over.
  const [{ step, visit }, setNav] = useState({ step: initial, visit: 0 })
  const [store, setStore] = useState(() => makeStore())
  const ref = useRef<HTMLDivElement>(null)
  const go = (next: string) => {
    setNav((n) => ({ step: next, visit: n.visit + 1 }))
    ref.current?.closest('[data-gp-frame-scroll]')?.scrollTo(0, 0)
  }
  useEffect(() => {
    controllers[oid] = go
    restarts[oid] = () => {
      setStore(makeStore())
      go('entry')
    }
  })
  const Screen = flow.screens[step] as ComponentType | undefined
  return (
    <StoreContext.Provider value={store}>
      <GoContext.Provider value={go}>
        <div
          ref={ref}
          className="contents"
          data-gp-step={step}
          // Bubble, not capture: the element's own onClick (a useFlowState setter)
          // runs before the screen it sits on unmounts.
          onClick={(e) => {
            const target = (e.target as Element).closest('[data-go]')
            if (target) go(target.getAttribute('data-go') ?? 'entry')
          }}
          // A copied link or button drawn as role="link"/"button" (raw <a> is banned)
          // still answers the keyboard, as the product's does.
          onKeyDown={(e) => {
            const target = (e.target as Element).closest(
              '[data-go][role="link"], [data-go][role="button"]',
            )
            if (!target || target !== e.target) return
            const role = target.getAttribute('role')
            if (e.key === 'Enter' || (e.key === ' ' && role === 'button')) {
              e.preventDefault()
              ;(target as HTMLElement).click()
            }
          }}
        >
          {Screen ? <Screen key={visit} /> : <Missing what={step} />}
        </div>
      </GoContext.Provider>
    </StoreContext.Provider>
  )
}

const StateScreen = ({ flow, id }: { flow: FlowModule; id: string }) => {
  const state = flow.states?.[id]
  const store = useMemo(() => makeStore(state?.values), [state])
  const Screen = state?.screen as ComponentType | undefined
  return (
    <StoreContext.Provider value={store}>
      {Screen ? <Screen /> : <Missing what={id} />}
    </StoreContext.Provider>
  )
}

const Option = ({
  oid,
  flow,
  nodes,
}: {
  oid: string
  flow: FlowModule
  nodes: Record<string, Element | null>
}) => {
  const [product, setProduct] = useState<Product>(
    flow.products?.[0] ?? pageProduct(),
  )
  const label = (p: Product) => (p === 'win' ? 'Win' : 'Serve')
  const x = oid.slice(-1)
  const one = document.querySelector('main[data-design="one"]') !== null
  // The tab opens the product the switch shows, not the flow's first one.
  const preview = `?view=desktop${one ? '' : `&option=${x}`}${
    flow.products && flow.products.length > 1 ? `&product=${product}` : ''
  }`
  const build = document.querySelector(`#${oid} .build-shape`)
    ? `?view=build${one ? '' : `&option=${x}`}`
    : null
  return (
    <ProductContext.Provider value={product}>
      {nodes.head
        ? createPortal(
            <>
              <Button
                id={`${x}-restart`}
                variant="outline"
                size="small"
                onClick={() => restarts[oid]?.()}
              >
                Restart
              </Button>
              <Button
                id={`${x}-desktop-preview`}
                variant="outline"
                size="small"
                asChild
              >
                <a href={preview} target="_blank" rel="noopener">
                  Desktop preview
                </a>
              </Button>
              {build ? (
                <Button
                  id={`${x}-build-shape`}
                  variant="outline"
                  size="small"
                  asChild
                >
                  <a href={build} target="_blank" rel="noopener">
                    Show how it&apos;s built
                  </a>
                </Button>
              ) : null}
              {flow.products && flow.products.length > 1 ? (
                <ToggleGroup
                  id={`${x}-product`}
                  type="single"
                  variant="outline"
                  value={product}
                  onValueChange={(v) => v && setProduct(v as Product)}
                  aria-label="Product"
                >
                  {flow.products.map((p) => (
                    <ToggleGroupItem key={p} value={p}>
                      {label(p)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              ) : null}
            </>,
            nodes.head,
          )
        : null}
      {nodes.flow
        ? createPortal(
            <Frame className="gp-frame gp-frame--phone" id={`${x}-frame`}>
              <Navigator oid={oid} flow={flow} initial="entry" />
            </Frame>,
            nodes.flow,
          )
        : null}
      {nodes.states
        ? createPortal(
            Object.entries(flow.states ?? {}).map(([id, s]) => (
              <figure key={id} id={`${x}-state-${id}`}>
                <figcaption>{s.label}</figcaption>
                <Frame className="gp-frame gp-frame--phone">
                  <StateScreen flow={flow} id={id} />
                </Frame>
              </figure>
            )),
            nodes.states,
          )
        : null}
    </ProductContext.Provider>
  )
}

const View = ({
  oid,
  flow,
  view,
  params,
}: {
  oid: string
  flow: FlowModule
  view: string
  params: URLSearchParams
}) => {
  const product =
    (params.get('product') as Product | null) ??
    flow.products?.[0] ??
    pageProduct()
  const state = params.get('state')
  return (
    <ProductContext.Provider value={product}>
      <Frame className={`gp-frame gp-frame--view-${view}`}>
        {state ? (
          <StateScreen flow={flow} id={state} />
        ) : (
          <Navigator
            oid={oid}
            flow={flow}
            initial={params.get('step') ?? 'entry'}
          />
        )}
      </Frame>
    </ProductContext.Provider>
  )
}

export const mount = (flows: Record<string, FlowModule>) => {
  // shoot.mjs reads each option's paths from here to walk them.
  ;(window as unknown as { gpPaths: Record<string, unknown> }).gpPaths =
    Object.fromEntries(
      Object.entries(flows).map(([oid, f]) => [oid, f.paths ?? {}]),
    )
  const params = new URLSearchParams(location.search)
  const view = params.get('view')
  if (view === 'build') {
    const shape = document.querySelector(
      `#option-${params.get('option') ?? 'a'} .build-shape`,
    )
    document.body.dataset.view = view
    const host = document.createElement('div')
    host.id = 'gp-view'
    document.body.append(host)
    if (shape) host.append(shape)
    else createRoot(host).render(<Missing what="build shape" />)
    return
  }
  if (view === 'phone' || view === 'desktop') {
    const oid = `option-${params.get('option') ?? 'a'}`
    const flow = flows[oid]
    document.body.dataset.view = view
    const host = document.createElement('div')
    host.id = 'gp-view'
    document.body.append(host)
    createRoot(host).render(
      flow ? (
        <View oid={oid} flow={flow} view={view} params={params} />
      ) : (
        <Missing what={oid} />
      ),
    )
    return
  }
  for (const [oid, flow] of Object.entries(flows)) {
    const find = (attr: string) =>
      document.querySelector(`[data-gp-${attr}="${oid}"]`)
    const nodes = {
      head: find('head'),
      flow: find('flow'),
      states: find('states'),
    }
    const host = document.createElement('div')
    host.hidden = true
    document.body.append(host)
    createRoot(host).render(<Option oid={oid} flow={flow} nodes={nodes} />)
  }
  // Any [data-go] outside a frame drives the flow of the option it sits in.
  document.addEventListener('click', (e) => {
    const target = (e.target as Element).closest('[data-go]')
    if (!target || target.closest('[data-gp-frame]')) return
    const oid = target.closest('section[id^="option-"]')?.id
    if (oid && controllers[oid])
      controllers[oid](target.getAttribute('data-go') ?? 'entry')
  })
}
