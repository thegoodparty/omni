import { describe, expect, it } from 'vitest'
import {
  buildProductKnowledgeBlocks,
  SUPPORT_EMAIL,
  SUPPORT_ROUTE,
} from './productKnowledgePrompt'

const render = (mode: 'win' | 'serve') =>
  buildProductKnowledgeBlocks(mode).join('\n\n')

describe('product knowledge blocks', () => {
  it('wraps the map in a tag, so it reads as data not instructions', () => {
    for (const mode of ['win', 'serve'] as const) {
      const map = buildProductKnowledgeBlocks(mode)[0] ?? ''
      expect(map.startsWith('<product_map>'), mode).toBe(true)
      expect(map.trimEnd().endsWith('</product_map>'), mode).toBe(true)
    }
  })

  // The failure this whole module exists to stop: fifteen of fifty audited
  // sessions ended in a handoff, naming eight different routes between them
  // (two email addresses, a help URL, a help center, live chat, a chat widget,
  // a chat bubble, and a contact form). Asserting on the set of addresses the
  // prompt contains, rather than on forbidden words: the rules legitimately
  // NAME a help center and a contact form, to forbid inventing them.
  it('names exactly one support email, in both products', () => {
    for (const mode of ['win', 'serve'] as const) {
      const prompt = render(mode)
      expect(prompt).toContain(SUPPORT_ROUTE)
      const emails = new Set(prompt.match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? [])
      expect([...emails], mode).toEqual([SUPPORT_EMAIL])
    }
  })

  it('offers the in-product chat before the email', () => {
    for (const mode of ['win', 'serve'] as const) {
      const prompt = render(mode)
      expect(prompt.indexOf(SUPPORT_ROUTE)).toBeLessThan(
        prompt.indexOf(SUPPORT_EMAIL),
      )
    }
  })

  it('tells the assistant not to guess a location it cannot see', () => {
    for (const mode of ['win', 'serve'] as const) {
      expect(render(mode)).toMatch(/NEVER guess a tab/)
    }
  })

  // The audit's sharpest miss: two third-party canvassing apps recommended to
  // a candidate who already had our door-knocking tool.
  it('rules out third-party tools for things we build', () => {
    for (const mode of ['win', 'serve'] as const) {
      expect(render(mode)).toMatch(/third-party tool/)
      expect(render(mode)).toContain('door knocking')
    }
  })

  // The manager was relaying web-search results about GoodParty back to a
  // logged-in GoodParty user.
  it('forbids web search for questions about our own product', () => {
    for (const mode of ['win', 'serve'] as const) {
      expect(render(mode)).toMatch(
        /Do not use web search for questions about GoodParty/,
      )
    }
  })

  it('shows Win its own tabs and none of Serve’s', () => {
    const prompt = render('win')
    expect(prompt).toContain('Voter Data')
    expect(prompt).toContain('Campaign Tracker')
    expect(prompt).toContain('Know Your Opponent')
    expect(prompt).not.toContain('Briefing Assistant')
    expect(prompt).not.toContain('Community Issues')
    expect(prompt).not.toContain('Constituent Data')
  })

  it('shows Serve its own tabs and none of Win’s', () => {
    const prompt = render('serve')
    expect(prompt).toContain('Constituent Data')
    expect(prompt).toContain('Briefing Assistant')
    expect(prompt).toContain('Ordinances')
    expect(prompt).not.toContain('Know Your Opponent')
    expect(prompt).not.toContain('Campaign Tracker')
  })

  // The "where are my lists" session took six turns and ended with the
  // candidate reading their own menu back to the assistant.
  it('puts saved lists on the right tab in both products', () => {
    expect(render('win')).toMatch(
      /Saved lists live HERE[\s\S]*?not under Contacts/,
    )
    expect(render('serve')).toMatch(/Saved lists live HERE/)
  })

  it('says plainly that the public profile is separate from the story', () => {
    expect(render('win')).toMatch(/Public Profile is separate/)
  })

  it('names the other product without offering it', () => {
    expect(render('win')).toMatch(
      /separate product for people already in office/,
    )
    expect(render('serve')).toMatch(
      /separate product for people running for office/,
    )
  })
})
