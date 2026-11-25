import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { prefersReducedMotion } from './Reveal'

// "All set": little blue texts fly edge to edge overhead. Each crosses the
// stage on its own wave (two sines on progress plus a bob on time). The
// pointer pushes any it passes near, scaled by how fast it moves, and a
// damped spring brings the bubble back to its path. Three depths differ in
// size, speed, strength and blur.

const BUBBLE_PATH =
  'M11 0h24c5 0 9 4 9 9v6c0 5-4 9-9 9H13.5c-2.6 0-5.2 1.4-8.4 4.1 1-1.8 1.3-3.4.7-4.9C3.4 21.9 2 19.6 2 17V9c0-5 4-9 9-9z'
const SVG_NS = 'http://www.w3.org/2000/svg'

interface Spec {
  width: number
  seconds: number
  opacity: number
  blur: number
  // How hard the pointer pushes it.
  give: number
}

const SPECS: Spec[] = [
  { width: 20, seconds: 12, opacity: 0.35, blur: 0.6, give: 0.45 },
  { width: 22, seconds: 11, opacity: 0.4, blur: 0.5, give: 0.45 },
  { width: 18, seconds: 13, opacity: 0.3, blur: 0.7, give: 0.4 },
  { width: 30, seconds: 7.8, opacity: 0.7, blur: 0, give: 0.8 },
  { width: 32, seconds: 8.4, opacity: 0.75, blur: 0, give: 0.8 },
  { width: 28, seconds: 7.2, opacity: 0.7, blur: 0, give: 0.75 },
  { width: 44, seconds: 5.4, opacity: 1, blur: 0, give: 1 },
  { width: 40, seconds: 6, opacity: 1, blur: 0, give: 1 },
]

interface Flyer {
  element: HTMLSpanElement
  spec: Spec
  progress: number
  lane: number
  waveA: number
  waveAFreq: number
  waveAPhase: number
  waveB: number
  waveBFreq: number
  waveBPhase: number
  bob: number
  bobFreq: number
  bobPhase: number
  pushX: number
  pushY: number
  speedX: number
  speedY: number
}

const flyer = (spec: Spec, index: number): Flyer => {
  const element = document.createElement('span')
  element.className = 'fly'
  element.style.setProperty('--w', `${spec.width}px`)
  element.style.setProperty('--blur', `${spec.blur}px`)
  element.style.opacity = String(spec.opacity)
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 46 30')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('fill', 'currentColor')
  path.setAttribute('d', BUBBLE_PATH)
  svg.appendChild(path)
  const line = (y: string, width: string, opacity: string): void => {
    const rect = document.createElementNS(SVG_NS, 'rect')
    rect.setAttribute('x', '12')
    rect.setAttribute('y', y)
    rect.setAttribute('width', width)
    rect.setAttribute('height', '3')
    rect.setAttribute('rx', '1.5')
    rect.setAttribute('fill', '#fff')
    rect.setAttribute('opacity', opacity)
    svg.appendChild(rect)
  }
  line('7.5', '22', '.92')
  line('13.5', '15', '.6')
  element.appendChild(svg)
  const seed = index * 2.39
  return {
    element,
    spec,
    progress: (index * 0.37 + 0.11) % 1,
    lane: 0.18 + ((index * 0.31) % 0.55),
    waveA: 10 + (index % 3) * 6,
    waveAFreq: 1 + (index % 2),
    waveAPhase: seed,
    waveB: 5 + (index % 2) * 4,
    waveBFreq: 2.3 + (index % 3) * 0.6,
    waveBPhase: seed * 1.7,
    bob: 3 + (index % 3) * 1.5,
    bobFreq: 0.45 + (index % 4) * 0.12,
    bobPhase: seed,
    pushX: 0,
    pushY: 0,
    speedX: 0,
    speedY: 0,
  }
}

// The band of flying texts and the spacer that keeps its room above the
// headline. The band spans the whole step, edge to edge, so it lives on the
// step itself and is placed from the spacer.
export const Sky = (): React.JSX.Element => {
  const spacerRef = useRef<HTMLDivElement>(null)
  const bandRef = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState<Element | null>(null)

  useEffect(() => {
    setStep(spacerRef.current?.closest('.step') ?? null)
  }, [])

  useEffect(() => {
    const spacer = spacerRef.current
    const band = bandRef.current
    const stage = step?.closest('.stage')
    if (!spacer || !band || !step || !stage || prefersReducedMotion()) return

    const flyers = SPECS.map(flyer)
    band.replaceChildren(...flyers.map(({ element }) => element))
    const pointer = { x: -1e4, y: -1e4, vx: 0, vy: 0, at: 0 }
    let frame = 0
    let last = 0

    const placeBand = (): void => {
      const top =
        spacer.getBoundingClientRect().top -
        step.getBoundingClientRect().top +
        step.scrollTop
      band.style.top = `${top - 10}px`
    }

    const tick = (now: number): void => {
      if (!frame) return
      const dt = Math.min(0.05, (now - (last || now)) / 1000)
      last = now
      const width = band.clientWidth
      const height = band.clientHeight
      const time = now / 1000
      const pointerSpeed =
        now - pointer.at > 120 ? 0 : Math.hypot(pointer.vx, pointer.vy)
      flyers.forEach((each) => {
        each.progress += dt / each.spec.seconds
        if (each.progress >= 1) {
          each.progress -= 1
          each.pushX = each.pushY = each.speedX = each.speedY = 0
        }
        const x = -70 + (width + 140) * each.progress
        const y =
          height * each.lane +
          each.waveA *
            Math.sin(6.283 * each.waveAFreq * each.progress + each.waveAPhase) +
          each.waveB *
            Math.sin(6.283 * each.waveBFreq * each.progress + each.waveBPhase) +
          each.bob * Math.sin(6.283 * each.bobFreq * time + each.bobPhase)
        const centerX = x + each.pushX + each.spec.width / 2
        const centerY = y + each.pushY + each.spec.width * 0.3
        const dx = centerX - pointer.x
        const dy = centerY - pointer.y
        const reach = 50 + each.spec.width * 1.2
        const distance = Math.hypot(dx, dy)
        if (distance < reach && distance > 0.01) {
          const near = 1 - distance / reach
          const push =
            (900 + Math.min(2400, pointerSpeed * 1.4)) * near * each.spec.give
          each.speedX += (dx / distance) * push * dt
          each.speedY += (dy / distance) * push * dt
        }
        each.speedX += (-26 * each.pushX - 4.2 * each.speedX) * dt
        each.speedY += (-26 * each.pushY - 4.2 * each.speedY) * dt
        each.pushX += each.speedX * dt
        each.pushY += each.speedY * dt
        const tilt = Math.max(
          -28,
          Math.min(
            28,
            3.5 * Math.sin(6.283 * each.bobFreq * time * 1.3 + each.bobPhase) +
              each.speedY * 0.05 -
              each.speedX * 0.03,
          ),
        )
        each.element.style.transform = `translate(${(x + each.pushX).toFixed(1)}px,${(y + each.pushY).toFixed(1)}px) rotate(${tilt.toFixed(1)}deg)`
      })
      frame = requestAnimationFrame(tick)
    }

    const onMove = (event: Event): void => {
      if (!(event instanceof PointerEvent)) return
      const box = band.getBoundingClientRect()
      const x = event.clientX - box.left
      const y = event.clientY - box.top
      const now = performance.now()
      const dt = Math.max(8, now - pointer.at) / 1000
      if (pointer.x > -1e3) {
        pointer.vx = (x - pointer.x) / dt
        pointer.vy = (y - pointer.y) / dt
      }
      pointer.x = x
      pointer.y = y
      pointer.at = now
    }
    const onLeave = (): void => {
      pointer.x = -1e4
      pointer.y = -1e4
      pointer.vx = pointer.vy = 0
    }

    placeBand()
    frame = requestAnimationFrame(tick)
    const on = requestAnimationFrame(() => band.classList.add('on'))
    stage.addEventListener('pointermove', onMove)
    stage.addEventListener('pointerleave', onLeave)
    window.addEventListener('resize', placeBand)

    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(on)
      frame = 0
      band.classList.remove('on')
      stage.removeEventListener('pointermove', onMove)
      stage.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('resize', placeBand)
      band.replaceChildren()
    }
  }, [step])

  return (
    <>
      {step &&
        createPortal(
          <div className="skyband" ref={bandRef} aria-hidden />,
          step,
        )}
      <div className="sky" ref={spacerRef} aria-hidden />
    </>
  )
}
