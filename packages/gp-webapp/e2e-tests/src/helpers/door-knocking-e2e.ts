import { expect, type Locator, type Page } from '@playwright/test'
import { NavigationHelper } from 'src/helpers/navigation.helper'

// Helpers for the door-knocking surface (app/dashboard/door-knocking/).

export const DOOR_KNOCKING_PATH = '/dashboard/door-knocking'

export const printWalkListPath = (turfId: number | string): string =>
  `${DOOR_KNOCKING_PATH}/print/${turfId}`

export const gotoDoorKnocking = async (page: Page): Promise<void> => {
  await page.goto(DOOR_KNOCKING_PATH, { waitUntil: 'domcontentloaded' })
  await NavigationHelper.dismissOverlays(page)
  await expect(page).toHaveURL(/\/dashboard\/door-knocking/)
}

// There is deliberately no turf seeder here any more.
//
// Until 3.0 a turf could be written on its own — polygon and filter, nothing
// bought — and the route was a separate, paid call no spec made. Creating a
// list and buying its Geoapify route are now ONE transaction, so seeding a row
// to look at would bill a shared credit pool on every run of a suite that gates
// every PR in the monorepo, and would take a 30s third-party call as a
// dependency of the gate. Nothing in this suite is worth that.
//
// So the specs here cover only what an org with no lists can reach, and
// everything about a list that exists — the rail row, the details sheet, the
// printed sheet — is asserted in unit tests, where a list costs a fixture:
// TurfList.test.tsx, TurfDetailsSheet.test.tsx, WalkSheet.test.tsx. The
// cross-service half that no mock can confirm has its own gp-api suite in
// src/doorKnocking/tests/doorKnocking.routes.test.ts.

// A create-flow step, by the title a canvasser reads at the top of it.
//
// `OutreachFlowShell` draws that title twice: once as the `sr-only`
// `DrawerTitle` that gives the dialog its accessible name, and once as the
// visible `h3` `Intro` renders in the step body. So an unqualified
// `getByRole('heading', { name })` is a strict-mode violation on every step of
// every v2 outreach flow, not only this one. Pinned to the visible `h3` — the
// thing the step actually shows; the sr-only twin is covered where it matters,
// as the dialog's name.
export const createFlowStepHeading = (page: Page, name: string): Locator =>
  page.getByRole('heading', { name, exact: true, level: 3 })

// ---------------------------------------------------------------------------
// Drawing a boundary on the map
// ---------------------------------------------------------------------------

export type LngLat = [number, number]

// maplibre's world is 512px wide at zoom 0 and doubles per zoom level.
const WORLD_PX = 512

const mercator = ([lng, lat]: LngLat, zoom: number): [number, number] => {
  const scale = WORLD_PX * 2 ** zoom
  const sin = Math.sin((lat * Math.PI) / 180)
  return [
    ((lng + 180) / 360) * scale,
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  ]
}

type MapView = {
  box: { x: number; y: number; width: number; height: number }
  center: LngLat
  zoom: number
}

const readMapView = async (page: Page): Promise<MapView> => {
  const map = page.getByTestId('voter-map')
  await expect(map).toHaveAttribute('data-map-ready', 'true', {
    timeout: 60_000,
  })
  const box = await map.boundingBox()
  if (!box) throw new Error('voter-map has no bounding box')
  const [lng, lat] = ((await map.getAttribute('data-map-center')) ?? '')
    .split(',')
    .map(Number)
  const zoom = Number(await map.getAttribute('data-map-zoom'))
  if (lng === undefined || lat === undefined || !Number.isFinite(zoom)) {
    throw new Error('voter-map is ready but publishes no camera')
  }
  return { box, center: [lng, lat], zoom }
}

const toPixel = (view: MapView, point: LngLat): [number, number] => {
  const [cx, cy] = mercator(view.center, view.zoom)
  const [px, py] = mercator(point, view.zoom)
  return [
    view.box.x + view.box.width / 2 + (px - cx),
    view.box.y + view.box.height / 2 + (py - cy),
  ]
}

// Where a click is safe: inside the map, clear of the zoom/undo cluster on the
// right and of the bottom sheet that covers the map below `lg`.
const safeRect = (view: MapView) => ({
  left: view.box.x + view.box.width * 0.08,
  right: view.box.x + view.box.width * 0.72,
  top: view.box.y + view.box.height * 0.08,
  bottom: view.box.y + view.box.height * 0.6,
})

// Closest two vertices must stay further apart than the map's 8px vertex pick
// radius, or a click would grab a vertex instead of placing one.
const MIN_SPACING_PX = 40

const settledZoom = async (page: Page, before: number): Promise<void> => {
  const map = page.getByTestId('voter-map')
  await expect
    .poll(async () => Number(await map.getAttribute('data-map-zoom')))
    .not.toBe(before)
}

// Clicks `ring`'s corners onto the map, in order, and returns once they are
// down. The map must already be in drawing mode (a surface-specific press such
// as "Draw the first turf"), and nothing here closes the shape: the canvas
// closes it from whatever vertices exist.
//
// Pixels are derived from the camera the canvas publishes on its container
// (`data-map-center`, `data-map-zoom`, after `data-map-ready`), never from
// fixed offsets, so the same longitude and latitude lands on the same street
// at any viewport size. The ring is first panned to the middle and zoomed to a
// workable size. Reusable by the Serve flow, which draws on the same canvas.
export const drawPolygon = async (
  page: Page,
  ring: LngLat[],
): Promise<void> => {
  // A closed GeoJSON ring repeats its first vertex; clicking it twice would
  // be dropped as a duplicate anyway.
  const corners = ring.slice(
    0,
    ring[0] && sameVertex(ring[0], ring.at(-1)) ? -1 : undefined,
  )
  const centroid: LngLat = [
    corners.reduce((sum, [lng]) => sum + lng, 0) / corners.length,
    corners.reduce((sum, [, lat]) => sum + lat, 0) / corners.length,
  ]

  for (let attempt = 0; attempt < 12; attempt++) {
    const view = await readMapView(page)
    const rect = safeRect(view)
    const pixels = corners.map((corner) => toPixel(view, corner))
    const inside = pixels.every(
      ([x, y]) =>
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
    )
    const spacing = Math.min(
      ...pixels.flatMap(([x, y], i) =>
        pixels.slice(i + 1).map(([ox, oy]) => Math.hypot(x - ox, y - oy)),
      ),
    )

    if (inside && spacing >= MIN_SPACING_PX) {
      for (const [x, y] of pixels) {
        await page.mouse.click(x, y)
      }
      return
    }

    const map = page.getByTestId('voter-map')
    const zoomBefore = view.zoom
    const [cx, cy] = toPixel(view, centroid)
    const mapCx = view.box.x + view.box.width / 2
    const mapCy = view.box.y + view.box.height / 2
    // Centre the ring in the safe area before changing zoom: zooming keeps the
    // centre fixed, so an off-centre ring would only drift further out.
    const targetX = (rect.left + rect.right) / 2
    const targetY = (rect.top + rect.bottom) / 2
    if (Math.hypot(cx - targetX, cy - targetY) > 24 && attempt < 6) {
      const centerBefore = await map.getAttribute('data-map-center')
      await page.mouse.move(mapCx, mapCy)
      await page.mouse.down()
      await page.mouse.move(mapCx + (targetX - cx), mapCy + (targetY - cy), {
        steps: 10,
      })
      await page.mouse.up()
      await expect
        .poll(() => map.getAttribute('data-map-center'))
        .not.toBe(centerBefore)
      continue
    }

    const zoomButton = spacing < MIN_SPACING_PX ? 'Zoom in' : 'Zoom out'
    await page.getByRole('button', { name: zoomButton, exact: true }).click()
    await settledZoom(page, zoomBefore)
  }
  throw new Error('could not frame the polygon on the map to draw it')
}

const sameVertex = (a: LngLat, b: LngLat | undefined): boolean =>
  b !== undefined && a[0] === b[0] && a[1] === b[1]
