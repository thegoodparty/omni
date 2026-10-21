import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  CIVIC_PANEL_JOIN_LINE,
  CIVIC_PANEL_LEAVE_LINE,
} from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import {
  SmsComposeStep,
  type SmsRequiredPart,
  standardsFailureCopy,
} from './SmsComposeStep'
import { OPT_OUT_FOOTER } from './smsCompose.util'

const INTRO = 'this is Jane, your Mayor.'
const PAID_FOR_BY = 'Paid for by Friends of Jane.'

const renderStep = (
  standardsFailures: SmsRequiredPart[],
  paidForByText: string | null = PAID_FOR_BY,
) => {
  const onAddRequiredBack = vi.fn()
  const onImageChange = vi.fn()
  const onImageError = vi.fn()
  const { container } = render(
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
      composedLength={44}
      aiAction="improve"
      onAiAction={vi.fn()}
      isDrafting={false}
      isDraftError={false}
      canUndo={false}
      onUndo={vi.fn()}
      imagePreviewUrl={null}
      onImageChange={onImageChange}
      imageError={null}
      onImageError={onImageError}
      continueAttempts={0}
    />,
  )
  return { onAddRequiredBack, onImageChange, onImageError, container }
}

describe('standardsFailureCopy', () => {
  const context = { identificationExample: INTRO, paidForByText: PAID_FOR_BY }

  it.each<[SmsRequiredPart, string, string | undefined]>([
    ['opt_out_line', 'Your text needs its opt-out line.', OPT_OUT_FOOTER],
    ['first_name_token', 'Your text needs its greeting', 'Hello [First name],'],
    ['paid_for_by', 'Your text needs its disclaimer.', PAID_FOR_BY],
    ['candidate_name', 'Your text needs your name.', INTRO],
    [
      'civic_panel_join',
      'Your text needs its civic panel ask.',
      CIVIC_PANEL_JOIN_LINE,
    ],
    [
      'civic_panel_leave',
      'Your text needs the line for leaving your civic panel.',
      CIVIC_PANEL_LEAVE_LINE,
    ],
    ['link_shortener', 'Your text has a shortened link', undefined],
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
    ['civic_panel_join', 'Add the civic panel ask back'],
    ['civic_panel_leave', 'Add the civic panel line back'],
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

describe('SmsComposeStep image pick', () => {
  const pick = async (container: HTMLElement, file: File) => {
    const input = container.querySelector<HTMLInputElement>('input[type=file]')
    if (!input) throw new Error('no file input')
    await userEvent.upload(input, file)
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
})
