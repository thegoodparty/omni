import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PanelDrawer, PanelDrawerBody, PanelDrawerHeader } from './PanelDrawer'

const originalWidth = window.innerWidth
const setWidth = (width: number) =>
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  })

const renderFrame = (onDismiss = vi.fn()) => {
  render(
    <PanelDrawer
      sheetClassName="sm:max-w-[430px]"
      drawerClassName="h-[92dvh]"
      hasDescription={false}
      onDismiss={onDismiss}
      busy={false}
    >
      <PanelDrawerHeader title="Robin Household" />
      <PanelDrawerBody>Did they answer?</PanelDrawerBody>
    </PanelDrawer>,
  )
  return onDismiss
}

afterEach(() => setWidth(originalWidth))

// The frame picks drawer or sheet on its first render. Starting as a phone
// drawer and swapping to the sheet a frame later handed focus back as the
// drawer unmounted, and that dismissed the step as it opened.
describe('PanelDrawer', () => {
  it('opens as the side sheet on a desktop from its first render, and stays open', () => {
    setWidth(1280)
    const onDismiss = renderFrame()

    expect(
      screen.getByRole('dialog', { name: 'Robin Household' }),
    ).toBeVisible()
    expect(document.querySelector('[data-slot="sheet-content"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull()
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('opens as the bottom drawer below lg', () => {
    setWidth(390)
    renderFrame()

    expect(
      document.querySelector('[data-slot="drawer-content"]'),
    ).not.toBeNull()
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull()
  })
})
