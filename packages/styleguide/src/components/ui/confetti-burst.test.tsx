import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ConfettiBurst } from './confetti-burst'

// jsdom runs no CSS animations, so anything driven by the real animation clock
// is asserted through the DOM contract instead: which nodes exist, which class
// is on the center, and what a dispatched animationend does.
const canvas = () =>
  document.querySelector('[data-slot="confetti-burst-canvas"]')
const center = () =>
  document.querySelector('[data-slot="confetti-burst-center"]')
const lastParticle = () =>
  document.querySelector('[data-confetti-last="true"]') as HTMLElement

const fire = (
  rerender: (ui: React.ReactElement) => void,
  ui: React.ReactElement,
) =>
  act(() => {
    rerender(ui)
  })

// jsdom defines no AnimationEvent, and Testing Library's fireEvent.animationEnd
// therefore delivers animationName as null — which would make the handler's
// name guard vacuously true and the test meaningless. Define the property on a
// plain Event instead; React reads it off the native event.
const endAnimation = (el: Element, animationName: string) => {
  const event = new Event('animationend', { bubbles: true })
  Object.defineProperty(event, 'animationName', { value: animationName })
  act(() => {
    el.dispatchEvent(event)
  })
}

describe('ConfettiBurst', () => {
  it('renders no burst until play flips true', () => {
    const { rerender } = render(
      <ConfettiBurst play={false}>
        <span>icon</span>
      </ConfettiBurst>,
    )

    expect(screen.getByText('icon')).toBeInTheDocument()
    expect(canvas()).toBeNull()

    fire(
      rerender,
      <ConfettiBurst play>
        <span>icon</span>
      </ConfettiBurst>,
    )

    expect(canvas()).not.toBeNull()
  })

  it('re-keys the canvas on each replay so the animations restart', () => {
    const { rerender } = render(<ConfettiBurst play={false} />)

    fire(rerender, <ConfettiBurst play />)
    const first = canvas()

    // A replay is false→true, which is what the component watches for.
    fire(rerender, <ConfettiBurst play={false} />)
    fire(rerender, <ConfettiBurst play />)
    const second = canvas()

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    // A new node rather than the same one re-rendered: the key bump is the
    // restart mechanism, so reusing the node would mean no second burst.
    expect(second).not.toBe(first)
  })

  it('calls onComplete once, and only for the last particle finishing its travel', () => {
    const onComplete = vi.fn()
    const { rerender } = render(
      <ConfettiBurst play={false} onComplete={onComplete} />,
    )
    fire(rerender, <ConfettiBurst play onComplete={onComplete} />)

    const last = lastParticle()
    const others = [
      ...document.querySelectorAll('[data-confetti-last="false"]'),
    ] as HTMLElement[]

    // Every particle runs a fade alongside its travel; only travel reports.
    endAnimation(last, 'confetti-particle-fade')
    expect(onComplete).not.toHaveBeenCalled()

    // Nor do the other nine particles, or onComplete would fire ten times.
    expect(others.length).toBe(9)
    endAnimation(others[0]!, 'confetti-fly')
    expect(onComplete).not.toHaveBeenCalled()

    endAnimation(last, 'confetti-fly')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('applies the pop-in to the center itself, not the caller', () => {
    const { rerender } = render(
      <ConfettiBurst play={false}>
        <span>icon</span>
      </ConfettiBurst>,
    )

    // Nothing to pop before the first fire — the center just renders.
    expect(center()).not.toHaveClass('animate-pop-in')

    fire(
      rerender,
      <ConfettiBurst play>
        <span>icon</span>
      </ConfettiBurst>,
    )

    expect(center()).toHaveClass('animate-pop-in')
    // The caller passed no class of its own; the component owns this.
    expect(screen.getByText('icon')).not.toHaveClass('animate-pop-in')
  })
})
