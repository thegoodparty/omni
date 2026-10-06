import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { render } from 'helpers/test-utils/render'
import { OutreachSheet } from './OutreachSheet'

// vaul decides a release closes the drawer from the content's computed
// transform, which jsdom never sets, so a simulated swipe can never reach
// the close path here. The drag gate is therefore asserted on the drawer's
// configuration instead.
const { rootProps } = vi.hoisted(() => ({
  rootProps: { current: null as { handleOnly?: boolean } | null },
}))

vi.mock('vaul', async () => {
  const actual = await vi.importActual<typeof import('vaul')>('vaul')
  const Root = (props: ComponentProps<typeof actual.Drawer.Root>) => {
    rootProps.current = { handleOnly: props.handleOnly }
    return <actual.Drawer.Root {...props} />
  }
  return { ...actual, Drawer: { ...actual.Drawer, Root } }
})

describe('OutreachSheet', () => {
  it('leaves nothing on the content for a downward drag to dismiss', () => {
    // A tap on Complete Purchase that drifted down on a phone read as a
    // swipe-to-close, and the flow then asked to discard the draft.
    render(
      <OutreachSheet open onOpenChange={vi.fn()} header={<h2>Review</h2>}>
        <button type="button">Complete Purchase</button>
      </OutreachSheet>,
    )

    expect(rootProps.current?.handleOnly).toBe(true)
  })
})
