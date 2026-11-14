import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { SmsCropStep } from './SmsCropStep'

describe('SmsCropStep', () => {
  it('hands back the file untouched when the whole image already fits a phone', async () => {
    const onCropReady = vi.fn()
    const file = new File(['x'], 'photo.png', { type: 'image/png' })
    render(<SmsCropStep file={file} onCropReady={onCropReady} />)

    const img = await screen.findByAltText('Your image to crop')
    for (const [key, value] of [
      ['width', 400],
      ['height', 300],
      ['naturalWidth', 800],
      ['naturalHeight', 600],
    ] as const) {
      Object.defineProperty(img, key, { value, configurable: true })
    }
    fireEvent.load(img)

    await waitFor(() => expect(onCropReady).toHaveBeenCalledWith(file))
  })
})
