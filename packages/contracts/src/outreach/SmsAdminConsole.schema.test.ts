import { describe, expect, it } from 'vitest'
import { checkSmsStandards } from './SmsAdminConsole.schema'

// A compliant baseline every case below edits, so a failure names the one rule
// under test rather than the four the fixture forgot.
const compliant = [
  'Hi {first_name}, it is Jane Doe running for City Council.',
  'Read the plan at https://janedoe.com/plan',
  'Paid for by Friends of Jane.',
  'Reply STOP to opt out.',
].join('\n')

const context = {
  candidateNames: ['Jane Doe'],
  committeeName: 'Friends of Jane',
}

describe('checkSmsStandards link_shortener', () => {
  it('passes a script whose links are full web addresses', () => {
    expect(checkSmsStandards(compliant, context)).toEqual({
      passed: true,
      failures: [],
    })
  })

  // The message that cost a candidate two charges on 2026-09-30: the texting
  // vendor only rejects a shortener at job creation, which happens after the
  // card is charged, so this has to fail before checkout.
  it('fails the shortened donation link the vendor rejects after payment', () => {
    const verdict = checkSmsStandards(
      compliant.replace('https://janedoe.com/plan', 'https://bit.ly/47ri12e'),
      context,
    )

    expect(verdict.passed).toBe(false)
    expect(verdict.failures).toEqual(['link_shortener'])
  })

  // A shortener does not always arrive after a space. These are the shapes a
  // real script produces: a label, a comma, the end of a sentence.
  it('catches a shortener behind any punctuation', () => {
    for (const link of [
      'link:bit.ly/abc',
      'donate,bit.ly/abc',
      'here.bit.ly/abc',
      '(bit.ly/abc)',
    ]) {
      const verdict = checkSmsStandards(
        compliant.replace('https://janedoe.com/plan', link),
        context,
      )
      expect(verdict.failures, link).toContain('link_shortener')
    }
  })

  it('catches a shortener written without a scheme or a path', () => {
    for (const link of ['bit.ly/abc', 'www.tinyurl.com/abc', 'is.gd']) {
      const verdict = checkSmsStandards(
        compliant.replace('https://janedoe.com/plan', link),
        context,
      )
      expect(verdict.failures, link).toContain('link_shortener')
    }
  })

  // The host list is matched on boundaries, not substrings: a campaign domain
  // that happens to end in a shortener's name must still be sendable.
  it('does not fire on a full domain that merely contains a shortener name', () => {
    for (const link of [
      'https://rabbit.lyrics.example.com/x',
      'https://t.community/x',
      'https://bit.lyric.example.org',
      'mybit.ly/x',
      'my-bit.ly-thing',
      // A shortener's name is also the start of longer, legitimate domains.
      'https://t.co.uk/donate',
      'https://is.gd.example.com/page',
    ]) {
      const verdict = checkSmsStandards(
        compliant.replace('https://janedoe.com/plan', link),
        context,
      )
      expect(verdict.failures, link).not.toContain('link_shortener')
    }
  })
})
