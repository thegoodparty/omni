import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { SmsPreviewStep } from './SmsPreviewStep'
import {
  PRO_BUILD_STEP_ORDER,
  STEP_ORDER,
  VERIFY_BUILD_STEP_ORDER,
  withPreviewStep,
} from './SmsFlow'

describe('withPreviewStep', () => {
  it.each([
    [
      'create',
      STEP_ORDER,
      ['purpose', 'audience', 'compose', 'preview', 'schedule', 'review'],
    ],
    [
      'pro build',
      PRO_BUILD_STEP_ORDER,
      ['purpose', 'audience', 'compose', 'preview', 'schedule'],
    ],
    [
      'verify build',
      VERIFY_BUILD_STEP_ORDER,
      ['purpose', 'audience', 'compose', 'preview', 'schedule', 'review'],
    ],
  ])(
    'puts preview right after compose in the %s order',
    (_, order, expected) => {
      expect(withPreviewStep(order, true)).toEqual(expected)
    },
  )

  it('leaves every order unchanged when the flag is off', () => {
    for (const order of [
      STEP_ORDER,
      PRO_BUILD_STEP_ORDER,
      VERIFY_BUILD_STEP_ORDER,
    ]) {
      expect(withPreviewStep(order, false)).toEqual(order)
    }
  })
})

describe('SmsPreviewStep', () => {
  const renderStep = (onEdit = vi.fn()) => {
    render(
      <SmsPreviewStep
        mode="create"
        script="Hello Sam, the park opens Saturday."
        imageUrl="https://example.com/wide.png"
        onEdit={onEdit}
      />,
    )
    return onEdit
  }

  it('renders the script and warns about a 3:1 image', () => {
    renderStep()
    expect(
      screen.getByText('Hello Sam, the park opens Saturday.'),
    ).toBeInTheDocument()
    const img = screen.getByAltText('Campaign attachment') as HTMLImageElement
    Object.defineProperty(img, 'complete', { value: true })
    Object.defineProperty(img, 'naturalWidth', { value: 900 })
    Object.defineProperty(img, 'naturalHeight', { value: 300 })
    fireEvent.load(img)
    expect(
      screen.getByText(/Very wide image.*Phones will crop the sides\./),
    ).toBeInTheDocument()
  })

  it('hands back to compose on Edit', async () => {
    const onEdit = renderStep()
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onEdit).toHaveBeenCalledOnce()
  })
})
