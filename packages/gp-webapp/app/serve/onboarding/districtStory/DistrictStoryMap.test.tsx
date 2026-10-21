import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { DistrictStoryMap } from './DistrictStoryMap'
import {
  buildAbstractDots,
  type DistrictMapMode,
  SQUARE_VIEW_HEIGHT,
} from './districtDots'

const model = buildAbstractDots(SQUARE_VIEW_HEIGHT)
const SAMPLE = model.dots.filter((dot) => dot.sample).length
const JOINED = Math.ceil(SAMPLE / 2)

const dots = () =>
  [...screen.getByTestId('district-story-map').querySelectorAll('circle')]
    .filter((circle) => circle.dataset.look)
    .map((circle) => circle.dataset.look)

const count = (looks: (string | undefined)[], look: string) =>
  looks.filter((value) => value === look).length

const renderMap = (mode: DistrictMapMode, animate = false) =>
  render(
    <DistrictStoryMap
      model={model}
      mode={mode}
      animate={animate}
      intro={animate}
    />,
  )

describe('DistrictStoryMap', () => {
  it('draws every dot in the accent on the first step', () => {
    renderMap('all')
    expect(count(dots(), 'fill-primary')).toBe(model.dots.length)
  })

  it('highlights the loud cluster and greys the rest', () => {
    renderMap('dim')
    const looks = dots()
    expect(count(looks, 'fill-warning')).toBe(12)
    expect(count(looks, 'fill-muted-foreground')).toBe(model.dots.length - 12)
    expect(screen.getAllByTestId('district-story-halo')).toHaveLength(12)
  })

  it('brings out the sample', () => {
    renderMap('sample')
    expect(count(dots(), 'fill-primary')).toBe(SAMPLE)
    expect(screen.queryByTestId('district-story-halo')).not.toBeInTheDocument()
  })

  it('shows the sample as rings with some filled in', () => {
    renderMap('grow')
    const looks = dots()
    expect(count(looks, 'fill-primary')).toBe(JOINED)
    expect(count(looks, 'ring')).toBe(SAMPLE - JOINED)
  })

  it('turns the sample to rings before some fill in', async () => {
    const { rerender } = renderMap('sample', true)
    rerender(
      <DistrictStoryMap model={model} mode="grow" animate intro={false} />,
    )
    expect(count(dots(), 'ring')).toBe(SAMPLE)
    await waitFor(() => expect(count(dots(), 'fill-primary')).toBe(JOINED))
  })

  it('starts the intro hidden and keeps the same dots across modes', () => {
    const { rerender } = renderMap('all', true)
    const first = screen
      .getByTestId('district-story-map')
      .querySelector('circle')!
    expect(first.getAttribute('style')).toContain('scale(0)')
    rerender(
      <DistrictStoryMap model={model} mode="dim" animate intro={false} />,
    )
    const again = screen
      .getByTestId('district-story-map')
      .querySelector('circle')!
    expect(again).toBe(first)
    expect(again.getAttribute('cx')).toBe(String(model.dots[0]!.x))
  })
})
