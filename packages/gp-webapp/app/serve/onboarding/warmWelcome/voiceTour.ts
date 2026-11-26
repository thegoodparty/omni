// The camera that tours the resident comments: it opens wide over the
// district, flies down to the first place, then moves from place to place,
// holding at each one while its comment is up.
//
// Positions are Web Mercator world coordinates at zoom 0 (a 256px world) and
// `zoom` is counted the same way, so one unit of zoom doubles the scale. The
// live map is driven to the same camera each frame, and the zones are placed
// with the same math, so they sit on the map whether or not it has drawn.

export interface TourPlace {
  lat: number
  lon: number
}

export interface TourCamera extends TourPlace {
  zoom: number
}

export interface TourView {
  // Which place's comment is on the card.
  index: number
  // Which place's zone is lit, or -1 before the first.
  live: number
  // The comment card is up.
  up: boolean
  paused: boolean
  // How long the comment stays, for the ring that fills while it does.
  holdSeconds: number
}

export const TOUR_OPEN_ZOOM = 11.3
export const TOUR_STREET_ZOOM = 16
// From one comment to the next.
const HOP_MS = 8700
const FIRST_MS = 2800
const PAN_MS = 2000
const SETTLE_MS = 150
// Up to this many pixels of travel at street zoom (about 2.5km) the camera
// pans straight; past it the camera lifts mid-flight, more the farther it
// goes, and takes a little longer.
const BUMP_FROM_PX = 1400
const MAX_BUMP = 2.6

export const worldPoint = ({
  lat,
  lon,
}: TourPlace): { x: number; y: number } => {
  const sin = Math.sin((lat * Math.PI) / 180)
  return {
    x: ((lon + 180) / 360) * 256,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 256,
  }
}

// Where a place lands in a view of this size. The camera's own point sits
// 40px above the middle, clear of the comment card, and never so high that
// its zone is cut off.
export const cameraAnchorY = (height: number): number =>
  Math.max(height / 2 - 40, 64)

export const projectPlace = (
  place: TourPlace,
  camera: TourCamera,
  size: { width: number; height: number },
): { x: number; y: number; scale: number; opacity: number } => {
  const at = worldPoint(place)
  const center = worldPoint(camera)
  const pixels = Math.pow(2, camera.zoom)
  return {
    x: size.width / 2 + (at.x - center.x) * pixels,
    y: cameraAnchorY(size.height) + (at.y - center.y) * pixels,
    scale: Math.pow(2, camera.zoom - TOUR_STREET_ZOOM),
    opacity: Math.max(0, Math.min(1, (camera.zoom - 13) / 1.5)),
  }
}

export const legBump = (from: TourPlace, to: TourPlace): number => {
  const a = worldPoint(from)
  const b = worldPoint(to)
  const pixels = Math.hypot(b.x - a.x, b.y - a.y) * 65536
  return pixels <= BUMP_FROM_PX
    ? 0
    : Math.min(MAX_BUMP, Math.log2(pixels / BUMP_FROM_PX) + 0.5)
}

const smoother = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)

export interface VoiceTour {
  start: (delayMs: number) => void
  stop: () => void
  // The chevrons: step through the places either way and restart the clock.
  go: (delta: 1 | -1) => void
  // Hovering the map while a comment is up holds it until the pointer leaves.
  hover: (over: boolean) => void
}

export const createVoiceTour = ({
  places,
  home,
  animate,
  onCamera,
  onView,
}: {
  places: TourPlace[]
  home: TourPlace
  // False under reduced motion: the camera cuts from place to place.
  animate: boolean
  onCamera: (camera: TourCamera) => void
  onView: (view: TourView) => void
}): VoiceTour => {
  const camera: TourCamera = { ...home, zoom: TOUR_OPEN_ZOOM }
  let view: TourView = {
    index: 0,
    live: -1,
    up: false,
    paused: false,
    holdSeconds: (HOP_MS - PAN_MS - SETTLE_MS) / 1000,
  }
  let on = false
  let hovering = false
  let hopTimer: ReturnType<typeof setTimeout> | undefined
  let upTimer: ReturnType<typeof setTimeout> | undefined
  let nextAt = 0
  let remaining = 0
  let frame = 0
  let flight: ((now: number) => void) | null = null

  const show = (patch: Partial<TourView>): void => {
    view = { ...view, ...patch }
    onView(view)
  }

  const loop = (now: number): void => {
    if (!frame) return
    flight?.(now)
    onCamera(camera)
    frame = requestAnimationFrame(loop)
  }

  const flyTo = (to: TourPlace, duration: number, bump: number): void => {
    if (!animate) {
      Object.assign(camera, to, { zoom: TOUR_STREET_ZOOM })
      flight = null
      onCamera(camera)
      return
    }
    const from = { ...camera }
    let startedAt: number | null = null
    flight = (now) => {
      startedAt ??= now
      const t = Math.min(1, (now - startedAt) / duration)
      const eased = smoother(t)
      camera.lat = from.lat + (to.lat - from.lat) * eased
      camera.lon = from.lon + (to.lon - from.lon) * eased
      camera.zoom =
        from.zoom +
        (TOUR_STREET_ZOOM - from.zoom) * eased -
        bump * Math.sin(Math.PI * t)
      if (t >= 1) flight = null
    }
  }

  const pause = (): void => {
    if (!on || view.paused || !view.up) return
    remaining = Math.max(0, nextAt - performance.now())
    clearTimeout(hopTimer)
    show({ paused: true })
  }

  const schedule = (ms: number): void => {
    clearTimeout(hopTimer)
    nextAt = performance.now() + ms
    hopTimer = setTimeout(() => hop(1), ms)
  }

  // One place: the comment drops, the camera moves (a gentle zoom in for the
  // first, a pan at street level for the rest), the comment comes up.
  const showPlace = (index: number, first: boolean): void => {
    const place = places[index]
    if (!place) return
    const bump = first ? 0 : legBump(camera, place)
    const duration = first ? FIRST_MS : PAN_MS + Math.round(bump * 500)
    show({
      live: index,
      up: false,
      paused: false,
      holdSeconds:
        ((first ? HOP_MS - PAN_MS : HOP_MS - duration) - SETTLE_MS) / 1000,
    })
    flyTo(place, duration, bump)
    clearTimeout(upTimer)
    upTimer = setTimeout(
      () => {
        if (!on) return
        show({ index, up: true })
        if (hovering) pause()
      },
      (animate ? duration : 0) + SETTLE_MS,
    )
  }

  const hop = (delta: number): void => {
    if (!on || places.length === 0) return
    const index = (view.index + delta + places.length) % places.length
    view = { ...view, index }
    showPlace(index, false)
    schedule(HOP_MS)
  }

  const stop = (): void => {
    on = false
    clearTimeout(hopTimer)
    clearTimeout(upTimer)
    flight = null
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  }

  return {
    start: (delayMs) => {
      stop()
      if (places.length === 0) return
      on = true
      Object.assign(camera, home, { zoom: TOUR_OPEN_ZOOM })
      show({ index: 0, live: -1, up: false, paused: false })
      onCamera(camera)
      if (animate) frame = requestAnimationFrame(loop)
      hopTimer = setTimeout(() => {
        showPlace(0, true)
        schedule(FIRST_MS - PAN_MS + HOP_MS)
      }, delayMs)
    },
    stop,
    go: (delta) => hop(delta),
    hover: (over) => {
      hovering = over
      if (over) {
        pause()
        return
      }
      if (!view.paused) return
      show({ paused: false })
      if (on) schedule(Math.max(remaining, 800))
    },
  }
}
