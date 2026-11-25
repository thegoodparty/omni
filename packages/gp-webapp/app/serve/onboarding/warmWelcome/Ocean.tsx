import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from './Reveal'

// The ask's picture: an ocean of small blue text bubbles bobbing gently.
// Every few seconds one of them swells, turns red, shoves its neighbors
// aside, trembles and shouts in exclamation marks, then settles back. The
// loudest voice, literally. Each bubble drifts around a home spot on a soft
// spring, and a pass keeps bubbles from overlapping, with the loud one much
// heavier than the rest.

const SHOUTS = ['!!', '?!', '!!!', '#!', '!?']
// Every loud bubble swells to the same size, four times the largest calm one.
const LOUD_SCALE = 2.4
const BUBBLE_PATH =
  'M11 0h24c5 0 9 4 9 9v6c0 5-4 9-9 9H13.5c-2.6 0-5.2 1.4-8.4 4.1 1-1.8 1.3-3.4.7-4.9C3.4 21.9 2 19.6 2 17V9c0-5 4-9 9-9z'
const SVG_NS = 'http://www.w3.org/2000/svg'

interface Bubble {
  element: HTMLSpanElement
  shout: HTMLElement
  // Its own size, and the size it is drawn at right now.
  size: number
  scale: number
  homeX: number
  homeY: number
  x: number
  y: number
  phase: number
  speed: number
  // 0 calm, 1 swelling or settling, 2 at full volume.
  loud: 0 | 1 | 2
  loudAt: number
  tilt: number
}

const bubbleSvg = (className: string, lines: boolean): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', className)
  svg.setAttribute('viewBox', '0 0 46 30')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('fill', 'currentColor')
  path.setAttribute('d', BUBBLE_PATH)
  svg.appendChild(path)
  if (lines) {
    const stroke = (y: string, width: string, opacity: string): void => {
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
    stroke('7.5', '22', '.92')
    stroke('13.5', '15', '.6')
  }
  return svg
}

export const Ocean = ({
  style,
}: {
  style?: React.CSSProperties
}): React.JSX.Element => {
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const rect = box.getBoundingClientRect()
    let width =
      rect.width ||
      Math.min(
        600,
        Math.max(
          240,
          box.parentElement?.clientWidth ??
            document.documentElement.clientWidth - 32,
        ),
      )
    let height = rect.height || 210
    const bubbles: Bubble[] = []
    const timers: ReturnType<typeof setTimeout>[] = []
    let frame = 0
    let last = 0
    let nextLoudAt = 0

    const separate = (): void => {
      for (let i = 0; i < bubbles.length; i++) {
        for (let j = i + 1; j < bubbles.length; j++) {
          const a = bubbles[i]
          const b = bubbles[j]
          if (!a || !b) continue
          const dx = b.x - a.x
          const dy = (b.y - a.y) * 1.5
          const distance = Math.sqrt(dx * dx + dy * dy) || 0.01
          const min = (a.scale + b.scale) * 23 + 5
          if (distance >= min) continue
          const push = (min - distance) / distance
          const weightA = a.loud ? 0.08 : 1
          const weightB = b.loud ? 0.08 : 1
          const total = weightA + weightB
          a.x -= dx * push * (weightA / total)
          a.y -= (dy * push * (weightA / total)) / 1.5
          b.x += dx * push * (weightB / total)
          b.y += (dy * push * (weightB / total)) / 1.5
        }
      }
      bubbles.forEach((bubble) => {
        const margin = bubble.scale * 23
        bubble.x = Math.max(margin, Math.min(width - margin, bubble.x))
        bubble.y = Math.max(
          margin * 0.66,
          Math.min(height - margin * 0.66, bubble.y),
        )
      })
    }

    const draw = (bubble: Bubble): void => {
      let shakeX = 0
      let shakeY = 0
      if (bubble.loud === 2) {
        shakeX = (Math.random() - 0.5) * 4
        shakeY = (Math.random() - 0.5) * 3
        bubble.tilt = (Math.random() - 0.5) * 8
      } else {
        bubble.tilt *= 0.8
      }
      bubble.element.style.transform = `translate(${(bubble.x - 23 + shakeX).toFixed(1)}px,${(bubble.y - 15 + shakeY).toFixed(1)}px) scale(${bubble.scale.toFixed(3)}) rotate(${bubble.tilt.toFixed(1)}deg)`
    }

    box.replaceChildren()
    const count = width < 420 ? 55 : 100
    for (let index = 0; index < count; index++) {
      const size = 0.22 + Math.random() * 0.38
      const element = document.createElement('span')
      element.className = 'ob'
      const shout = document.createElement('i')
      element.append(bubbleSvg('calm', true), bubbleSvg('angry', false), shout)
      element.style.setProperty('--o', '1')
      box.appendChild(element)
      const homeX = 36 + Math.random() * (width - 72)
      const homeY = 24 + Math.random() * (height - 48)
      bubbles.push({
        element,
        shout,
        size,
        scale: size,
        homeX,
        homeY,
        x: homeX,
        y: homeY,
        phase: Math.random() * 6.28,
        speed: 0.5 + Math.random() * 0.6,
        loud: 0,
        loudAt: 0,
        tilt: 0,
      })
    }
    // Settle the pack once so nothing starts overlapped, then fade the
    // bubbles in one after another.
    for (let pass = 0; pass < 40; pass++) separate()
    bubbles.forEach((bubble, index) => {
      bubble.homeX = bubble.x
      bubble.homeY = bubble.y
      draw(bubble)
      timers.push(
        setTimeout(() => bubble.element.classList.add('in'), 150 + index * 8),
      )
    })

    // Easing per unit of time, not per frame, so a slow screen still swells
    // and shoves on cue.
    const step = (now: number): void => {
      if (!frame) return
      const elapsed = Math.min(250, now - (last || now))
      last = now
      const frames = elapsed / 16.7
      const easeScale = 1 - Math.pow(0.75, frames)
      const easeHome = 1 - Math.pow(0.975, frames)
      const easeLoud = 1 - Math.pow(0.99, frames)
      if (now >= nextLoudAt) {
        const calm = bubbles.filter((bubble) => !bubble.loud)
        const pick = calm[Math.floor(Math.random() * calm.length)]
        if (pick) {
          pick.loud = 1
          pick.loudAt = now
          pick.shout.textContent =
            SHOUTS[Math.floor(Math.random() * SHOUTS.length)] ?? '!!'
          pick.element.classList.add('loud')
        }
        nextLoudAt = now + 3600 + Math.random() * 1200
      }
      bubbles.forEach((bubble) => {
        let target = bubble.size
        if (bubble.loud) {
          const age = now - bubble.loudAt
          if (age < 520) {
            const grown = 1 - Math.pow(1 - age / 520, 3)
            target = bubble.size + (LOUD_SCALE - bubble.size) * grown
            if (grown > 0.98) bubble.loud = 2
          } else if (age < 2500) {
            target = LOUD_SCALE
            bubble.loud = 2
          } else if (age < 3000) {
            const settled = (age - 2500) / 500
            target = LOUD_SCALE + (bubble.size - LOUD_SCALE) * settled
            bubble.loud = 1
            if (settled > 0.3) bubble.element.classList.remove('loud')
          } else {
            bubble.loud = 0
          }
        }
        bubble.scale += (target - bubble.scale) * easeScale
        // A gentle drift around home, then a soft spring back, so
        // neighbors meet and nudge each other.
        const driftX =
          bubble.homeX +
          Math.sin((now / 1000) * bubble.speed * 0.9 + bubble.phase) * 6
        const driftY =
          bubble.homeY +
          Math.sin((now / 1000) * bubble.speed * 1.3 + bubble.phase * 2) * 5
        const ease = bubble.loud ? easeLoud : easeHome
        bubble.x += (driftX - bubble.x) * ease
        bubble.y += (driftY - bubble.y) * ease
      })
      separate()
      separate()
      bubbles.forEach(draw)
      frame = requestAnimationFrame(step)
    }

    const onResize = (): void => {
      const next = box.getBoundingClientRect()
      if (next.width && width) {
        const ratio = next.width / width
        bubbles.forEach((bubble) => {
          bubble.homeX *= ratio
          bubble.x *= ratio
        })
      }
      width = next.width || width
      height = next.height || height
    }

    if (!prefersReducedMotion()) {
      nextLoudAt = performance.now() + 1500
      frame = requestAnimationFrame(step)
      window.addEventListener('resize', onResize)
    }

    return () => {
      timers.forEach(clearTimeout)
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      window.removeEventListener('resize', onResize)
      box.replaceChildren()
    }
  }, [])

  return <div className="ocean ui" style={style} ref={boxRef} aria-hidden />
}
