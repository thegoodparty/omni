import { describe, expect, it } from 'vitest'
import { userFactory } from '@/shared/test-utils'
import { buildPeerlySlackErrorMessage } from './buildPeerlySlackErrorMessage.util'

const collectTexts = (node: unknown): string[] =>
  Array.isArray(node)
    ? node.flatMap(collectTexts)
    : node !== null && typeof node === 'object'
      ? Object.entries(node).flatMap(([key, value]) =>
          key === 'text' && typeof value === 'string'
            ? [value]
            : collectTexts(value),
        )
      : []

const collectTypes = (node: unknown): string[] =>
  Array.isArray(node)
    ? node.flatMap(collectTypes)
    : node !== null && typeof node === 'object'
      ? Object.entries(node).flatMap(([key, value]) =>
          key === 'type' && typeof value === 'string'
            ? [value]
            : collectTypes(value),
        )
      : []

const user = userFactory({ id: 1 })

const REQUEST_SUMMARY =
  'POST https://app.peerly.com/api/v2/tdlc/11540328/verify_pin → 400'
const RESPONSE_DATA =
  '{\n  "Error": "Campaign Verify Verify PIN API request failed.",\n' +
  '  "status_code": 422\n}'

describe('buildPeerlySlackErrorMessage', () => {
  it('renders the request line and the Peerly response body', () => {
    const texts = collectTexts(
      buildPeerlySlackErrorMessage({
        user,
        requestSummary: REQUEST_SUMMARY,
        responseData: RESPONSE_DATA,
        peerlyIdentityId: '11540328',
      }),
    )

    expect(texts).toContain(REQUEST_SUMMARY)
    expect(texts).toContain(RESPONSE_DATA)
    // The omitted fallback message must not render as an empty bullet.
    expect(texts).not.toContain('')
  })

  it('puts the response body in a preformatted block so its indentation survives', () => {
    const types = collectTypes(
      buildPeerlySlackErrorMessage({
        user,
        requestSummary: REQUEST_SUMMARY,
        responseData: RESPONSE_DATA,
      }),
    )

    expect(types).toContain('rich_text_preformatted')
  })

  it('never renders request headers or an Authorization value', () => {
    const rendered = JSON.stringify(
      buildPeerlySlackErrorMessage({
        user,
        requestSummary: REQUEST_SUMMARY,
        responseData: RESPONSE_DATA,
        peerlyIdentityId: '11540328',
      }),
    )

    expect(rendered).not.toContain('Authorization')
    expect(rendered).not.toContain('JWT ')
    expect(rendered).not.toContain('headers')
  })

  it('falls back to the error message when there is no Axios context', () => {
    const blocks = buildPeerlySlackErrorMessage({
      user,
      errorMessage: 'socket hang up',
    })

    expect(collectTexts(blocks)).toContain('socket hang up')
    expect(collectTexts(blocks).some((t) => t.includes('undefined'))).toBe(
      false,
    )
    // Nothing to preformat, so no empty code block either.
    expect(collectTypes(blocks)).not.toContain('rich_text_preformatted')
  })

  it('omits the bullet list entirely when there is nothing to bullet', () => {
    const types = collectTypes(
      buildPeerlySlackErrorMessage({ user, responseData: RESPONSE_DATA }),
    )

    // The user block still lists name/email/phone, so exactly one list remains.
    expect(types.filter((type) => type === 'rich_text_list')).toHaveLength(1)
  })
})
