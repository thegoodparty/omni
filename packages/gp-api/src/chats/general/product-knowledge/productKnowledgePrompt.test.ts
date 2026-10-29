import { describe, expect, it } from 'vitest'
import {
  buildProductKnowledgeBlocks,
  HELP_CENTER_URL,
  SUPPORT_EMAIL,
  SUPPORT_ROUTE,
} from './productKnowledgePrompt'

const render = (mode: 'win' | 'serve') =>
  buildProductKnowledgeBlocks(mode, true, null).join('\n\n')

describe('product knowledge blocks', () => {
  it('wraps the map in a tag, so it reads as data not instructions', () => {
    for (const mode of ['win', 'serve'] as const) {
      const map = buildProductKnowledgeBlocks(mode, true, null)[0] ?? ''
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

  // Get help opens the knowledge base when the chat cannot load, so an
  // assistant told only about email will confirm a working click as broken and
  // send the user somewhere slower. The webapp changed this route; the rule
  // describing it has to change with it.
  it('names the help center fallback, not only the email', () => {
    for (const mode of ['win', 'serve'] as const) {
      const prompt = render(mode)
      expect(prompt, mode).toContain(HELP_CENTER_URL)
    }
  })

  // The route has to survive the search tool being absent: it describes what
  // the product does, not something the assistant can do.
  it('names the fallback even when the search tool did not register', () => {
    for (const mode of ['win', 'serve'] as const) {
      const prompt = buildProductKnowledgeBlocks(mode, false, null).join('\n\n')
      expect(prompt, mode).toContain(HELP_CENTER_URL)
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

  it('shows Win its own tabs and none of Serve’s', () => {
    const prompt = render('win')
    expect(prompt).toContain('Voter Data')
    expect(prompt).toContain('Campaign Plan')
    expect(prompt).toContain('Know Your Opponent')
    expect(prompt).not.toContain('Briefing Assistant')
    expect(prompt).not.toContain('Community Issues')
    expect(prompt).not.toContain('- Constituents (')
  })

  it('shows Serve its own tabs and none of Win’s', () => {
    const prompt = render('serve')
    expect(prompt).toContain('- Constituents (/dashboard/contacts)')
    expect(prompt).toContain('Briefing Assistant')
    expect(prompt).toContain('Ordinances')
    expect(prompt).not.toContain('Know Your Opponent')
    expect(prompt).not.toContain('Campaign Plan')
  })

  it("names each product's own social flow for the social-post handoff", () => {
    const win = render('win')
    const serve = render('serve')
    expect(win).toContain('Voter Outreach’s social flow')
    expect(win).not.toContain('opens Outreach’s social flow')
    expect(serve).toContain('opens Outreach’s social flow')
    expect(serve).not.toContain('Voter Outreach’s social flow')
  })

  // The prompt must never advertise a tool that did not register, same rule
  // as every other block in these two prompts.
  describe('help center gating', () => {
    it('advertises the search tool and its rules when it registered', () => {
      for (const mode of ['win', 'serve'] as const) {
        const prompt = render(mode)
        expect(prompt).toContain('HELP CENTER')
        expect(prompt).toContain('search_help_center')
      }
    })

    it('says nothing about a help center when the tool is absent', () => {
      for (const mode of ['win', 'serve'] as const) {
        const prompt = buildProductKnowledgeBlocks(mode, false, null).join(
          '\n\n',
        )
        expect(prompt).not.toContain('HELP CENTER')
        expect(prompt).not.toContain('search_help_center')
      }
    })

  })

  it('names the other product without offering it', () => {
    expect(render('win')).toMatch(
      /separate product for people already in office/,
    )
    expect(render('serve')).toMatch(
      /separate product for people running for office/,
    )
  })

  // Pro is the one account fact the map carries. It renders as data beside
  // the Access notes, only when the caller knows it, so a prompt that passes
  // null (Serve today) is unchanged.
  describe('Pro status in the map', () => {
    const map = (mode: 'win' | 'serve', proAccess: boolean | null): string =>
      buildProductKnowledgeBlocks(mode, true, proAccess)[0] ?? ''

    it('says the campaign is locked out of Pro areas when it has no Pro', () => {
      const block = map('win', false)
      expect(block).toContain('Pro status: this campaign does not have Pro')
    })

    it('says the campaign has Pro when it does', () => {
      const block = map('win', true)
      expect(block).toContain('Pro status: this campaign has Pro.')
      expect(block).not.toContain('does not have Pro')
    })

    it('says nothing about Pro when the caller does not know', () => {
      for (const mode of ['win', 'serve'] as const) {
        const prompt = buildProductKnowledgeBlocks(mode, true, null).join(
          '\n\n',
        )
        expect(prompt, mode).not.toContain('Pro status:')
      }
    })

    // "this campaign" is Win's noun and Pro is Win's account state, so a
    // Serve caller that passes a flag gets no line rather than the wrong one.
    it('renders the status line for Win only', () => {
      expect(map('serve', false)).not.toContain('Pro status:')
      expect(map('serve', true)).not.toContain('Pro status:')
    })
  })

  // The rule that reads the status line. Generic on purpose: it names no
  // feature, so when an Access note in the map changes, the behavior follows
  // without a prompt edit.
  describe('unmet access requirements', () => {
    const RULE_MARK = 'Access note says it needs Pro'
    const accessRule = (proAccess: boolean): string => {
      const rules = buildProductKnowledgeBlocks('win', true, proAccess)[1] ?? ''
      const bullet = rules.split('\n- ').find((b) => b.includes(RULE_MARK))
      expect(bullet, String(proAccess)).toBeDefined()
      return bullet ?? ''
    }

    it('names no feature, tab, or tool in the rule', () => {
      expect(accessRule(false)).not.toMatch(
        /voter|Voter Data|Know Your Opponent|count_contacts|precinct/i,
      )
    })

    // The rule reads the status line, so it renders only where that line
    // does: never for an unknown status, and never for Serve.
    it('omits the rule when the status line is absent', () => {
      for (const mode of ['win', 'serve'] as const) {
        const rules = buildProductKnowledgeBlocks(mode, true, null)[1] ?? ''
        expect(rules, mode).not.toContain(RULE_MARK)
      }
      const serve = buildProductKnowledgeBlocks('serve', true, false)[1] ?? ''
      expect(serve).not.toContain(RULE_MARK)
    })
  })
})
