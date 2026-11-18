// Mounts each option's flow on the review page, or one flow alone in ?view= mode.
// Page: [data-gp-head="option-a"] gets Restart, Desktop preview and, with both products,
// the Serve / Win switch; [data-gp-flow="option-a"] gets the phone frame;
// [data-gp-states="option-a"] gets Other states. Any [data-go] outside a frame drives
// the flow of the option it sits in.
// ?view=phone|desktop[&option=b][&step=2|&state=upload-failed] shows one frame alone at
// the window's size, for the Desktop preview tab and for screenshots.
import { useEffect, useRef, useState, type ComponentType } from 'react'
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
  type FlowModule,
  type Product,
} from './index'

const controllers: Record<string, (step: string) => void> = {}

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
  const ref = useRef<HTMLDivElement>(null)
  const go = (next: string) => {
    setNav((n) => ({ step: next, visit: n.visit + 1 }))
    ref.current?.closest('[data-gp-frame-scroll]')?.scrollTo(0, 0)
  }
  useEffect(() => {
    controllers[oid] = go
  })
  const Screen = flow.screens[step] as ComponentType | undefined
  return (
    <GoContext.Provider value={go}>
      <div
        ref={ref}
        className="contents"
        data-gp-step={step}
        onClickCapture={(e) => {
          const target = (e.target as Element).closest('[data-go]')
          if (target) go(target.getAttribute('data-go') ?? 'entry')
        }}
      >
        {Screen ? <Screen key={visit} /> : <Missing what={step} />}
      </div>
    </GoContext.Provider>
  )
}

const StateScreen = ({ flow, id }: { flow: FlowModule; id: string }) => {
  const state = flow.states?.[id]
  const Screen = state?.screen as ComponentType | undefined
  return Screen ? <Screen /> : <Missing what={id} />
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
  const preview = one ? '?view=desktop' : `?view=desktop&option=${x}`
  return (
    <ProductContext.Provider value={product}>
      {nodes.head
        ? createPortal(
            <>
              <Button
                id={`${x}-restart`}
                variant="outline"
                size="small"
                onClick={() => controllers[oid]?.('entry')}
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
    (params.get('product') as Product | null) ?? flow.products?.[0] ?? 'serve'
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
  const params = new URLSearchParams(location.search)
  const view = params.get('view')
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
