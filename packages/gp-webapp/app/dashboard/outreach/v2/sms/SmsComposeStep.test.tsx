import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SmsStandardsRule } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { SmsComposeStep, standardsFailureCopy } from './SmsComposeStep'
import { OPT_OUT_FOOTER } from './smsCompose.util'

const INTRO = 'this is Jane, your Mayor.'
const PAID_FOR_BY = 'Paid for by Friends of Jane.'

const renderStep = (
  standardsFailures: SmsStandardsRule[],
  paidForByText: string | null = PAID_FOR_BY,
) => {
  const onAddRequiredBack = vi.fn()
  render(
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
      protectedParts={[]}
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
      onImageChange={vi.fn()}
      imageError={null}
      onImageError={vi.fn()}
      continueAttempts={0}
    />,
  )
  return { onAddRequiredBack }
}

describe('standardsFailureCopy', () => {
  const context = { identificationExample: INTRO, paidForByText: PAID_FOR_BY }

  it.each<[SmsStandardsRule, string, string | undefined]>([
    ['opt_out_line', 'Your text needs its opt-out line.', OPT_OUT_FOOTER],
    ['first_name_token', 'Your text needs its greeting', 'Hello [First name],'],
    ['paid_for_by', 'Your text needs its disclaimer.', PAID_FOR_BY],
    ['candidate_name', "Your text needs to say who it's from.", INTRO],
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

  it.each<[SmsStandardsRule, string]>([
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
