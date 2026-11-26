import type Matter from 'matter-js'

type MatterModule = typeof Matter

// The warm welcome's confetti. Every piece is a rigid body, so pieces land
// on the footer's top edge (or on a card), knock into each other, pile up
// and go to sleep where they settle. The pointer wakes and nudges anything
// it brushes.
export interface Confetti {
  // Pieces pour from the top of the stage for a few seconds.
  pour: () => void
  // A pop from an element, without the pour.
  burst: (from: Element, count?: number) => void
  // The element's top edge becomes a surface pieces can settle on.
  addSurface: (surface: Element) => void
  // Fades the lot away and stops.
  clear: () => void
  destroy: () => void
}

const POUR_MS = 2800
const FADE_MS = 650
const WIDE_STAGE_PX = 1100
const BURST_PIECES = 26
const MAX_STEP_MS = 16.667

// The brand's reds and blues, and white. Read from the design tokens when
// the canvas starts, since a canvas cannot use a CSS variable.
const COLOR_TOKENS = [
  '--goodparty-red-500',
  '--goodparty-red-400',
  '--goodparty-red-300',
  '--goodparty-blue-500',
  '--goodparty-blue-400',
  '--goodparty-blue-300',
  '--tw-white',
]

interface Piece {
  body: Matter.Body
  color: string
  width: number
  height: number
}

export const createConfetti = (
  M: MatterModule,
  canvas: HTMLCanvasElement,
  floor: () => Element | null,
): Confetti | null => {
  const context = canvas.getContext('2d')
  if (!context) return null

  const tokens = getComputedStyle(document.documentElement)
  const colors = COLOR_TOKENS.map((token) =>
    tokens.getPropertyValue(token).trim(),
  ).filter(Boolean)

  let engine: Matter.Engine | null = null
  let pieces: Piece[] = []
  let frame = 0
  let fadeTimer: ReturnType<typeof setTimeout> | undefined
  let spawnUntil = 0
  let lastFrameAt = 0
  let width = 0
  let height = 0
  let floorY = 0
  let ratio = 1
  let pointer: { x: number; y: number; vx: number } | null = null
  let lastPointer: { x: number; y: number } | null = null

  const addPiece = (x: number, y: number, vx: number, vy: number): void => {
    if (!engine) return
    const pieceWidth = 5 + Math.random() * 4
    const pieceHeight = 7 + Math.random() * 6
    const body = M.Bodies.rectangle(x, y, pieceWidth, pieceHeight, {
      chamfer: { radius: 1.5 },
      frictionAir: 0.045,
      friction: 0.5,
      restitution: 0.08,
      density: 0.0008,
      angle: Math.random() * Math.PI * 2,
    })
    M.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.3)
    M.Body.setVelocity(body, { x: vx, y: vy })
    pieces.push({
      body,
      color: colors[Math.floor(Math.random() * colors.length)] ?? 'white',
      width: pieceWidth,
      height: pieceHeight,
    })
    M.Composite.add(engine.world, body)
  }

  const pourPiece = (): void =>
    addPiece(
      Math.random() * width,
      -20 - Math.random() * 60,
      (Math.random() - 0.5) * 2,
      1 + Math.random() * 2,
    )

  const draw = (): void => {
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    for (const piece of pieces) {
      context.save()
      context.translate(piece.body.position.x, piece.body.position.y)
      context.rotate(piece.body.angle)
      context.fillStyle = piece.color
      context.fillRect(
        -piece.width / 2,
        -piece.height / 2,
        piece.width,
        piece.height,
      )
      context.restore()
    }
  }

  const tick = (now: number): void => {
    if (!engine) {
      frame = 0
      return
    }
    const elapsed = Math.min(32, now - lastFrameAt)
    lastFrameAt = now
    const pouring = now < spawnUntil
    if (pouring) {
      pourPiece()
      if (width > WIDE_STAGE_PX) pourPiece()
    }
    const nudge = pointer
    for (const { body } of pieces) {
      // A flutter while a piece is still in the air.
      if (!body.isSleeping && body.position.y < floorY - 20) {
        M.Body.applyForce(body, body.position, {
          x: Math.sin(now / 180 + body.id) * 0.000012,
          y: 0,
        })
      }
      if (!nudge) continue
      const dx = body.position.x - nudge.x
      const dy = body.position.y - nudge.y
      const distanceSquared = dx * dx + dy * dy
      if (distanceSquared >= 2500) continue
      const distance = Math.sqrt(distanceSquared) || 1
      M.Sleeping.set(body, false)
      M.Body.applyForce(body, body.position, {
        x: (dx / distance) * 0.00018 + nudge.vx * 0.00004,
        y: (dy / distance) * 0.00012 - 0.00008,
      })
    }
    pointer = null
    M.Engine.update(engine, Math.min(elapsed, MAX_STEP_MS))
    draw()
    const awake = pieces.some(({ body }) => !body.isSleeping)
    frame = pouring || awake ? requestAnimationFrame(tick) : 0
  }

  const wake = (): void => {
    if (frame || !engine) return
    lastFrameAt = performance.now()
    frame = requestAnimationFrame(tick)
  }

  const stop = (): void => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    if (engine) {
      M.Composite.clear(engine.world, false)
      M.Engine.clear(engine)
    }
    engine = null
    pieces = []
  }

  // Measured as laid out, so the floor sits on the footer's top edge on
  // every screen.
  const start = (): void => {
    clearTimeout(fadeTimer)
    stop()
    canvas.style.opacity = '1'
    ratio = Math.min(2, window.devicePixelRatio || 1)
    const box = canvas.getBoundingClientRect()
    width = Math.round(box.width)
    height = Math.round(box.height)
    canvas.width = width * ratio
    canvas.height = height * ratio
    const floorBox = floor()?.getBoundingClientRect()
    floorY = floorBox
      ? Math.min(height, Math.round(floorBox.top - box.top))
      : height
    engine = M.Engine.create({
      enableSleeping: true,
      gravity: { x: 0, y: 0.55 },
      positionIterations: 8,
      velocityIterations: 6,
    })
    M.Composite.add(engine.world, [
      M.Bodies.rectangle(width / 2, floorY + 60, width + 400, 120, {
        isStatic: true,
        friction: 0.6,
      }),
      M.Bodies.rectangle(-60, height / 2, 120, height * 3, { isStatic: true }),
      M.Bodies.rectangle(width + 60, height / 2, 120, height * 3, {
        isStatic: true,
      }),
    ])
    spawnUntil = 0
    wake()
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (!engine) return
    const box = canvas.getBoundingClientRect()
    const x = event.clientX - box.left
    const y = event.clientY - box.top
    const vx = lastPointer ? x - lastPointer.x : 0
    lastPointer = { x, y }
    pointer = { x, y, vx: Math.max(-40, Math.min(40, vx)) }
    wake()
  }
  window.addEventListener('pointermove', onPointerMove, { passive: true })

  return {
    pour: () => {
      start()
      spawnUntil = performance.now() + POUR_MS
    },
    burst: (from, count = BURST_PIECES) => {
      if (!engine) start()
      const box = canvas.getBoundingClientRect()
      const source = from.getBoundingClientRect()
      const x = source.left - box.left + source.width / 2
      const y = source.top - box.top + source.height / 2
      for (let index = 0; index < count; index++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2
        const speed = 4 + Math.random() * 5
        addPiece(
          x + (Math.random() - 0.5) * source.width * 0.6,
          y,
          Math.cos(angle) * speed,
          Math.sin(angle) * speed,
        )
      }
      wake()
    },
    addSurface: (surface) => {
      if (!engine) return
      const box = canvas.getBoundingClientRect()
      const edge = surface.getBoundingClientRect()
      M.Composite.add(
        engine.world,
        M.Bodies.rectangle(
          edge.left - box.left + edge.width / 2,
          edge.top - box.top + 3,
          edge.width - 16,
          6,
          { isStatic: true, friction: 0.7, chamfer: { radius: 3 } },
        ),
      )
    },
    clear: () => {
      if (!engine) return
      canvas.style.opacity = '0'
      clearTimeout(fadeTimer)
      fadeTimer = setTimeout(() => {
        stop()
        context.setTransform(1, 0, 0, 1, 0, 0)
        context.clearRect(0, 0, canvas.width, canvas.height)
      }, FADE_MS)
    },
    destroy: () => {
      clearTimeout(fadeTimer)
      stop()
      window.removeEventListener('pointermove', onPointerMove)
    },
  }
}
