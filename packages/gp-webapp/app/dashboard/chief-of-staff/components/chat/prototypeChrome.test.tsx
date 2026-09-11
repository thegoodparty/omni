import { describe, expect, it } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen } from '@testing-library/react'
import { DEFAULT_CHAT_CHROME } from './chatChrome'
import {
  PROTO_ASSISTANT_BUBBLE,
  PROTOTYPE_CHAT_CHROME,
  ProtoAssistantRow,
} from './prototypeChrome'

// jsdom loads no stylesheets, so these assert the classes and structure that
// carry the design rather than computed pixels. The measured values were
// verified against the running app: 34px avatar, 10px row gap, #f7fafb bubble,
// 16/16/16/4 corners.
describe('prototype chat chrome', () => {
  it('renders the assistant turn with the design avatar and row gap', () => {
    const { container } = render(
      <ProtoAssistantRow>
        <p>hello</p>
      </ProtoAssistantRow>,
    )

    const row = container.querySelector('.proto-turn-in')
    expect(row).not.toBeNull()
    // 34px avatar + 10px gap is what makes ASSISTANT_INDENT 44px. If either
    // changes, WideChip's pl-11 has to change with it.
    expect(row?.className).toContain('gap-2.5')
    expect(container.querySelector('.size-\\[34px\\]')).not.toBeNull()
  })

  it('keeps the shared markdown plumbing while overriding only the chrome', () => {
    // The !block / !inline overrides are long and load-bearing; the prototype
    // bubble reuses them instead of restating them.
    expect(PROTO_ASSISTANT_BUBBLE).toContain('[&_p]:!block')
    expect(PROTO_ASSISTANT_BUBBLE).toContain('proto-bubble')
    expect(PROTO_ASSISTANT_BUBBLE).toContain('rounded-bl-sm')
    // tailwind-merge must have dropped the shared bubble's own radius rather
    // than leaving both to fight over stylesheet order.
    expect(PROTO_ASSISTANT_BUBBLE).not.toContain('rounded-2xl rounded-2xl')
  })

  it('announces the typing indicator to screen readers', () => {
    const { container } = render(<PROTOTYPE_CHAT_CHROME.ThinkingRow />)

    // The dots carry no meaning on their own, so the label has to survive.
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('Thinking...')).toHaveClass('sr-only')
    expect(container.querySelectorAll('.proto-dot')).toHaveLength(3)
  })

  it('is a distinct chrome from the shared default', () => {
    // The whole point of the fork: Win, the ordinance docks, the briefing
    // Ask-AI panel and the CRM assistant render the default and must not pick
    // any of this up.
    expect(PROTOTYPE_CHAT_CHROME.AssistantRow).not.toBe(
      DEFAULT_CHAT_CHROME.AssistantRow,
    )
    expect(PROTOTYPE_CHAT_CHROME.assistantBubble).not.toBe(
      DEFAULT_CHAT_CHROME.assistantBubble,
    )
  })
})
