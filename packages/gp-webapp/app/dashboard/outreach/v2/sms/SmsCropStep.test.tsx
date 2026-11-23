import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  CropperProps,
  CropperRef,
  CropperState,
} from 'react-advanced-cropper'
import { render } from 'helpers/test-utils/render'
import { SmsCropStep } from './SmsCropStep'
import { cropImageFile } from './smsCrop.util'

vi.mock('./smsCrop.util', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./smsCrop.util')>()),
  cropImageFile: vi.fn(),
}))

const cropper = vi.hoisted(() => ({ props: null as CropperProps | null }))

vi.mock('react-advanced-cropper', () => ({
  Cropper: (props: CropperProps) => {
    cropper.props = props
    return <div data-testid="cropper" />
  },
}))

const refAt = (left: number, top: number, width: number, height: number) =>
  ({
    getCoordinates: () => ({ left, top, width, height }),
  }) as CropperRef

describe('SmsCropStep', () => {
  beforeEach(() => {
    cropper.props = null
    // jsdom loads no images, so it has no decode to wait on.
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      value: () => Promise.resolve(),
      configurable: true,
    })
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(
      800,
    )
    vi.spyOn(
      HTMLImageElement.prototype,
      'naturalHeight',
      'get',
    ).mockReturnValue(600)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(HTMLImageElement.prototype, 'decode')
  })

  const renderStep = async (
    onCropReady = vi.fn(),
    extra: Partial<Parameters<typeof SmsCropStep>[0]> = {},
  ) => {
    const file = new File(['x'], 'photo.png', { type: 'image/png' })
    render(<SmsCropStep file={file} onCropReady={onCropReady} {...extra} />)
    await screen.findByTestId('cropper')
    return { file, onCropReady, props: cropper.props as CropperProps }
  }

  it('limits the crop to the shapes a phone shows uncropped', async () => {
    const { props } = await renderStep()
    expect(props.stencilProps?.aspectRatio).toEqual({
      minimum: 0.5,
      maximum: 2,
    })
  })

  it('shows the corners only after Crop, and hides them on Done', async () => {
    const { props } = await renderStep()
    expect(props.stencilProps?.resizable).toBe(false)
    expect(props.stencilProps?.movable).toBe(false)
    expect(screen.queryByText(/Drag the corners/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Crop' }))
    expect(cropper.props?.stencilProps?.resizable).toBe(true)
    expect(cropper.props?.stencilProps?.handlers?.eastSouth).toBe(true)
    expect(screen.getByText(/Drag the corners/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(cropper.props?.stencilProps?.resizable).toBe(false)
    expect(cropper.props?.stencilProps?.handlers?.eastSouth).toBe(false)
  })

  it('keeps the image at its fitted size, with no zoom or pan', async () => {
    const { props } = await renderStep()
    expect(props.backgroundWrapperProps).toEqual({
      scaleImage: false,
      moveImage: false,
    })
  })

  it('reports only the latest crop when an earlier one finishes late', async () => {
    const resolvers: Array<(file: File | null) => void> = []
    vi.mocked(cropImageFile).mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve)),
    )
    const { onCropReady, props } = await renderStep()
    props.onReady?.(refAt(0, 0, 400, 300))
    props.onInteractionEnd?.(refAt(10, 10, 300, 300))
    await waitFor(() => expect(resolvers).toHaveLength(2))

    const newer = new File(['new'], 'new.jpeg', { type: 'image/jpeg' })
    const older = new File(['old'], 'old.jpeg', { type: 'image/jpeg' })
    resolvers[1]?.(newer)
    await waitFor(() => expect(onCropReady).toHaveBeenLastCalledWith(newer))
    resolvers[0]?.(older)
    await Promise.resolve()
    expect(onCropReady).toHaveBeenLastCalledWith(newer)
  })

  it('cuts the crop in the original image pixels', async () => {
    vi.mocked(cropImageFile).mockResolvedValue(null)
    const { file, props } = await renderStep()
    props.onInteractionEnd?.(refAt(100, 50, 400, 300))
    await waitFor(() =>
      expect(cropImageFile).toHaveBeenCalledWith(
        file,
        expect.any(HTMLImageElement),
        { x: 100, y: 50, width: 400, height: 300 },
      ),
    )
    expect(
      await screen.findByText("We couldn't crop that image. Choose another."),
    ).toBeInTheDocument()
  })

  it('hands back the file untouched when the crop is the whole image', async () => {
    const { cropImageFile: real } =
      await vi.importActual<typeof import('./smsCrop.util')>('./smsCrop.util')
    vi.mocked(cropImageFile).mockImplementation(real)
    const { file, onCropReady, props } = await renderStep()
    props.onReady?.(refAt(0, 0, 800, 600))

    await waitFor(() => expect(onCropReady).toHaveBeenCalledWith(file))
  })

  it('reopens on the last crop and reports each new one', async () => {
    vi.mocked(cropImageFile).mockResolvedValue(null)
    const onCropChange = vi.fn()
    const { props } = await renderStep(vi.fn(), {
      initialCrop: { x: 100, y: 50, width: 400, height: 300 },
      onCropChange,
    })
    const start =
      typeof props.defaultCoordinates === 'function'
        ? props.defaultCoordinates(
            { imageSize: { width: 800, height: 600 } } as CropperState,
            {} as never,
          )
        : null
    expect(start).toEqual({ left: 100, top: 50, width: 400, height: 300 })

    props.onInteractionEnd?.(refAt(0, 0, 600, 600))
    expect(onCropChange).toHaveBeenCalledWith({
      x: 0,
      y: 0,
      width: 600,
      height: 600,
    })
  })
})
