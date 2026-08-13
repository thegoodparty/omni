import { describe, expect, it } from 'vitest'
import { resolveScriptContent } from './resolveScriptContent.util'

describe('resolveScriptContent', () => {
  it('normalizes CRLF in resolved aiContent scripts', () => {
    const aiContent = {
      smsPersuasive: { content: '<p>Hi there!\r\nVote for me.\r\n</p>' },
    }

    expect(resolveScriptContent('smsPersuasive', aiContent)).toBe(
      'Hi there!\nVote for me.\n',
    )
  })

  it('normalizes CRLF in raw scripts', () => {
    expect(resolveScriptContent('line one\r\nline two', {})).toBe(
      'line one\nline two',
    )
  })
})
