import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import {
  SmsComposeStep,
  type SmsRequiredPart,
  standardsFailureCopy,
} from './SmsComposeStep'
import { IMAGE_MAX_BYTES, OPT_OUT_FOOTER } from './smsCompose.util'

const INTRO = 'this is Jane, your Mayor.'
const PAID_FOR_BY = 'Paid for by Friends of Jane.'

const renderStep = (
  standardsFailures: SmsRequiredPart[],
  paidForByText: string | null = PAID_FOR_BY,
  composedLength = 44,
) => {
  const onAddRequiredBack = vi.fn()
  const onImageChange = vi.fn()
  const onImageError = vi.fn()
  // The message under the image lives in the flow above the step, so the
  // harness holds it there: a reported error has to render where a person
  // would see it, not only reach the callback.
  const Step = () => {
    const [imageError, setImageError] = useState<string | null>(null)
    return (
      <SmsComposeStep
        isServe={false}
        tone="warm"
        onToneChange={vi.fn()}
        standardsFailures={standardsFailures}
        unfilledBrackets={[]}
        identificationExample={INTRO}
        paidForByText={paidForByText}
        onAddRequiredBack={onAddRequiredBack}
        message="Hello {first_name}, the park opens Saturday."
        onMessageChange={vi.fn()}
        mergeTagChannel="peerly"
        hasWrittenBody
        composedLength={composedLength}
        aiAction="improve"
        onAiAction={vi.fn()}
        isDrafting={false}
        isDraftError={false}
        canUndo={false}
        onUndo={vi.fn()}
        imagePreviewUrl={null}
        onImageChange={onImageChange}
        imageError={imageError}
        onImageError={(message) => {
          onImageError(message)
          setImageError(message)
        }}
        continueAttempts={0}
      />
    )
  }
  const { container } = render(<Step />)
  return { onAddRequiredBack, onImageChange, onImageError, container }
}

describe('SmsComposeStep counter', () => {
  it('shows characters only, with no SMS segment count', () => {
    renderStep([])
    expect(screen.getByText('44 chars')).toBeInTheDocument()
    expect(screen.queryByText(/SMS/)).toBeNull()
  })

  it('stays neutral up to 1,000 characters', () => {
    renderStep([], PAID_FOR_BY, 1000)
    expect(screen.getByText('1000 chars')).not.toHaveClass('text-warning-dark')
    expect(screen.queryByText(/Shorter texts work better/)).toBeNull()
  })

  it('turns yellow and warns past 1,000 characters', () => {
    renderStep([], PAID_FOR_BY, 1001)
    expect(screen.getByText('1001 chars')).toHaveClass('text-warning-dark')
    expect(
      screen.getByText(
        'Shorter texts work better. Try to keep it under 1,000 characters.',
      ),
    ).toBeInTheDocument()
  })

  it('turns red past 2,000 characters, with the limit error alone', () => {
    renderStep([], PAID_FOR_BY, 2001)
    const counter = screen.getByText('2001 chars')
    expect(counter).toHaveClass('text-destructive')
    expect(counter).not.toHaveClass('text-warning-dark')
    expect(screen.queryByText(/Shorter texts work better/)).toBeNull()
    expect(screen.getByText(/under 2000 characters/)).toBeInTheDocument()
  })
})

describe('standardsFailureCopy', () => {
  const context = { identificationExample: INTRO, paidForByText: PAID_FOR_BY }

  it.each<[SmsRequiredPart, string, string | undefined]>([
    ['opt_out_line', 'Your text needs its opt-out line.', OPT_OUT_FOOTER],
    ['first_name_token', 'Your text needs its greeting', 'Hello [First name],'],
    ['paid_for_by', 'Your text needs its disclaimer.', PAID_FOR_BY],
    ['candidate_name', 'Your text needs your name.', INTRO],
    ['link_shortener', 'Your text has a shortened link', undefined],
    ['restricted_word', 'texting provider won\u2019t send', undefined],
  ])('says what happened and what to do for %s', (rule, problem, line) => {
    const copy = standardsFailureCopy(rule, context)
    expect(copy.problem).toContain(problem)
    expect(copy.fix.length).toBeGreaterThan(0)
    expect(copy.line).toBe(line)
    // docs/product-copy.md: no em dashes, and no "just".
    for (const text of [copy.problem, copy.fix]) {
      expect(text).not.toMatch(/[—–]/)
      expect(text).not.toMatch(/\bjust\b/i)
      expect(text).not.toMatch(/\{first_name\}|token/)
    }
  })

  it('names only the restricted words the message contains', () => {
    const copy = standardsFailureCopy('restricted_word', {
      identificationExample: INTRO,
      paidForByText: null,
      restrictedWords: ['transfer'],
    })
    expect(copy.fix).toContain('\u201ctransfer\u201d')
    expect(copy.fix).not.toContain('sexual')
    expect(copy.fix).not.toContain('stop2end')
  })

  it('offers no disclaimer to add back when there is no committee to name', () => {
    const copy = standardsFailureCopy('paid_for_by', {
      identificationExample: INTRO,
      paidForByText: null,
    })
    expect(copy.line).toBeUndefined()
    expect(copy.addBackLabel).toBeUndefined()
  })
})

describe('SmsComposeStep required-line errors', () => {
  it('shows the exact opt-out line, unquoted, with a way to add it back', async () => {
    const { onAddRequiredBack } = renderStep(['opt_out_line'])

    expect(
      screen.getByText(
        /Your text needs its opt-out line\. Add it back as the last line:/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(OPT_OUT_FOOTER)).toBeInTheDocument()
    expect(screen.queryByText(`"${OPT_OUT_FOOTER}"`)).toBeNull()

    await userEvent.click(
      screen.getByRole('button', { name: 'Add the opt-out line back' }),
    )
    expect(onAddRequiredBack).toHaveBeenCalledWith('opt_out_line')
  })

  it.each<[SmsRequiredPart, string]>([
    ['first_name_token', 'Add the greeting back'],
    ['paid_for_by', 'Add the disclaimer back'],
    ['candidate_name', 'Add your name back'],
  ])('adds the %s back in one click', async (rule, label) => {
    const { onAddRequiredBack } = renderStep([rule])
    await userEvent.click(screen.getByRole('button', { name: label }))
    expect(onAddRequiredBack).toHaveBeenCalledWith(rule)
  })

  it('offers nothing to add back for a shortened link', () => {
    renderStep(['link_shortener'])
    expect(
      screen.getByText(/Paste the full web address instead\./),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /back$/ })).toBeNull()
  })
})

describe('SmsComposeStep image attach', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const pick = async (container: HTMLElement, file: File) => {
    const input = container.querySelector<HTMLInputElement>('input[type=file]')
    if (!input) throw new Error('no file input')
    await userEvent.upload(input, file)
  }

  const dropzone = (container: HTMLElement): HTMLElement => {
    const zone = container.querySelector<HTMLElement>(
      '[data-slot="sms-image-dropzone"]',
    )
    if (!zone) throw new Error('no drop zone')
    return zone
  }

  const drop = (container: HTMLElement, file: File) =>
    fireEvent.drop(dropzone(container), { dataTransfer: { files: [file] } })

  const oversized = (name = 'photo.jpg', type = 'image/jpeg') =>
    new File([new Uint8Array(IMAGE_MAX_BYTES + 1)], name, { type })

  // jsdom cannot draw or encode, so the canvas answers with the sizes the
  // test asks for, one per toBlob call, recording the canvas it drew from.
  const stubCanvas = (sizes: number[]) => {
    const calls: { width: number; height: number; quality?: number }[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      function (this: HTMLCanvasElement, callback, _type, quality) {
        calls.push({ width: this.width, height: this.height, quality })
        const size = sizes[calls.length - 1] ?? 0
        callback(new Blob([new Uint8Array(size)], { type: 'image/jpeg' }))
      },
    )
    return calls
  }

  const stubBitmap = (width = 3000, height = 2000) => {
    const bitmap = { width, height, close: vi.fn() }
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
    return bitmap
  }

  it('hands on an in-memory copy, not the picked handle', async () => {
    const { container, onImageChange, onImageError } = renderStep([])
    const picked = new File(['jpeg-bytes'], 'photo.jpg', { type: 'image/jpeg' })

    await pick(container, picked)

    await vi.waitFor(() => expect(onImageChange).toHaveBeenCalledTimes(1))
    const handedOn: File = onImageChange.mock.calls[0]?.[0]
    expect(handedOn).not.toBe(picked)
    expect(handedOn.name).toBe('photo.jpg')
    expect(handedOn.type).toBe('image/jpeg')
    const text = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.readAsText(handedOn)
    })
    expect(text).toBe('jpeg-bytes')
    expect(onImageError).toHaveBeenLastCalledWith(null)
  })

  it('asks for the image again when the picked file cannot be read', async () => {
    const { container, onImageChange, onImageError } = renderStep([])
    const unreadable = new File(['x'], 'photo.jpg', { type: 'image/jpeg' })
    vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementationOnce(
      function (this: FileReader) {
        this.dispatchEvent(new ProgressEvent('error'))
      },
    )

    await pick(container, unreadable)

    await vi.waitFor(() =>
      expect(onImageError).toHaveBeenCalledWith(
        "We couldn't open that image. Choose it again or pick another.",
      ),
    )
    expect(onImageChange).not.toHaveBeenCalled()
  })

  it('shrinks a picked photo that is over the cap instead of refusing it', async () => {
    const { container, onImageChange, onImageError } = renderStep([])
    const bitmap = stubBitmap()
    // Over the cap at the first quality, under it at the second.
    const calls = stubCanvas([IMAGE_MAX_BYTES + 1, 400_000])

    await pick(container, oversized())

    await vi.waitFor(() => expect(onImageChange).toHaveBeenCalledTimes(1))
    const handedOn: File = onImageChange.mock.calls[0]?.[0]
    expect(handedOn.type).toBe('image/jpeg')
    expect(handedOn.size).toBe(400_000)
    expect(handedOn.size).toBeLessThanOrEqual(IMAGE_MAX_BYTES)
    expect(handedOn.name).toBe('photo.jpeg')
    expect(bitmap.close).toHaveBeenCalled()
    expect(onImageError).toHaveBeenLastCalledWith(null)
    // The 1600px long edge the crop reads from, at the first two qualities.
    expect(calls).toEqual([
      { width: 1600, height: 1067, quality: 0.9 },
      { width: 1600, height: 1067, quality: 0.75 },
    ])
  })

  it('reads the drop zone as a drop target too', () => {
    const { container } = renderStep([])
    expect(
      within(dropzone(container)).getByText(
        'Click or drag an image here. Recipients see it in the message preview.',
      ),
    ).toBeInTheDocument()
  })

  it('attaches a dropped PNG through the picker path', async () => {
    const { container, onImageChange, onImageError } = renderStep([])
    const dropped = new File(['png-bytes'], 'flyer.png', { type: 'image/png' })

    drop(container, dropped)

    await vi.waitFor(() => expect(onImageChange).toHaveBeenCalledTimes(1))
    const handedOn: File = onImageChange.mock.calls[0]?.[0]
    expect(handedOn.name).toBe('flyer.png')
    expect(handedOn.type).toBe('image/png')
    expect(onImageError).toHaveBeenLastCalledWith(null)
  })

  it('shrinks a dropped photo the same way it shrinks a picked one', async () => {
    const { container, onImageChange } = renderStep([])
    stubBitmap()
    stubCanvas([300_000])

    drop(container, oversized('IMG_0042.jpg'))

    await vi.waitFor(() => expect(onImageChange).toHaveBeenCalledTimes(1))
    expect(onImageChange.mock.calls[0]?.[0].size).toBe(300_000)
  })

  it('says at the zone why a dropped file was refused', async () => {
    const { container, onImageChange } = renderStep([])

    drop(container, new File(['x'], 'notes.pdf', { type: 'application/pdf' }))

    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent('Use a JPG, PNG, or GIF image.')
    // Beside the zone, not at the bottom of the step.
    expect(dropzone(container).parentElement).toContainElement(error)
    expect(onImageChange).not.toHaveBeenCalled()
  })

  it('says at the zone when an image will not shrink under the cap', async () => {
    const { container, onImageChange } = renderStep([])
    stubBitmap()
    stubCanvas(Array<number>(9).fill(IMAGE_MAX_BYTES + 1))

    await pick(container, oversized())

    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent(
      'That image is too large for a text. Choose a smaller one.',
    )
    expect(dropzone(container).parentElement).toContainElement(error)
    expect(onImageChange).not.toHaveBeenCalled()
  })

  it('asks for a smaller GIF rather than flatten it to one frame', async () => {
    const { container, onImageChange } = renderStep([])
    const createImageBitmap = vi.fn()
    vi.stubGlobal('createImageBitmap', createImageBitmap)

    drop(container, oversized('party.gif', 'image/gif'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That GIF is too large for a text. Choose one under 745 KB.',
    )
    expect(createImageBitmap).not.toHaveBeenCalled()
    expect(onImageChange).not.toHaveBeenCalled()
  })
})
