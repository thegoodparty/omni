import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { SmsCropStep } from './SmsCropStep'
import { cropImageFile } from './smsCrop.util'

vi.mock('./smsCrop.util', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./smsCrop.util')>()),
  cropImageFile: vi.fn(),
}))

describe('SmsCropStep', () => {
  const loadImage = async () => {
    const img = await screen.findByAltText('Your image to crop')
    for (const [key, value] of [
      ['width', 400],
      ['height', 300],
      ['naturalWidth', 800],
      ['naturalHeight', 600],
    ] as const) {
      Object.defineProperty(img, key, { value, configurable: true })
    }
    return img
  }

  it('reports only the latest crop when an earlier one finishes late', async () => {
    const resolvers: Array<(file: File | null) => void> = []
    vi.mocked(cropImageFile).mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve)),
    )
    const onCropReady = vi.fn()
    const file = new File(['x'], 'photo.png', { type: 'image/png' })
    render(<SmsCropStep file={file} onCropReady={onCropReady} />)
    const img = await loadImage()
    fireEvent.load(img)
    fireEvent.load(img)
    await waitFor(() => expect(resolvers).toHaveLength(2))

    const newer = new File(['new'], 'new.jpeg', { type: 'image/jpeg' })
    const older = new File(['old'], 'old.jpeg', { type: 'image/jpeg' })
    resolvers[1](newer)
    await waitFor(() => expect(onCropReady).toHaveBeenLastCalledWith(newer))
    resolvers[0](older)
    await Promise.resolve()
    expect(onCropReady).toHaveBeenLastCalledWith(newer)
  })

  it('hands back the file untouched when the whole image already fits a phone', async () => {
    const { cropImageFile: real } =
      await vi.importActual<typeof import('./smsCrop.util')>('./smsCrop.util')
    vi.mocked(cropImageFile).mockImplementation(real)
    const onCropReady = vi.fn()
    const file = new File(['x'], 'photo.png', { type: 'image/png' })
    render(<SmsCropStep file={file} onCropReady={onCropReady} />)
    fireEvent.load(await loadImage())

    await waitFor(() => expect(onCropReady).toHaveBeenCalledWith(file))
  })
})
