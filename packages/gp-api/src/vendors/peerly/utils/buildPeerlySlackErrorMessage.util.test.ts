import { describe, expect, it } from 'vitest'
import { userFactory } from '@/shared/test-utils'
import { buildPeerlySlackErrorMessage } from './buildPeerlySlackErrorMessage.util'

const user = userFactory({ id: 1 })

const REQUEST_SUMMARY =
  'POST https://app.peerly.com/api/v2/tdlc/11540328/verify_pin → 400'
const RESPONSE_DATA =
  '{\n  "Error": "Campaign Verify Verify PIN API request failed.",\n' +
  '  "status_code": 422\n}'

// JSON.stringify on the expected value gives the exact escaped, quoted form it
// takes inside the serialized blocks, so these match a rendered `text` value.
const quoted = (value: string) => JSON.stringify(value)

const countOf = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1

describe('buildPeerlySlackErrorMessage', () => {
  it('renders the request line and the Peerly response body', () => {
    const rendered = JSON.stringify(
      buildPeerlySlackErrorMessage({
        user,
        requestSummary: REQUEST_SUMMARY,
        responseData: RESPONSE_DATA,
        peerlyIdentityId: '11540328',
      }),
    )

    expect(rendered).toContain(quoted(REQUEST_SUMMARY))
    expect(rendered).toContain(quoted(RESPONSE_DATA))
    // The omitted fallback message must not render as an empty bullet — Slack
    // rejects a message carrying one.
    expect(rendered).not.toContain('"text":""')
  })

  it('puts the response body in a preformatted block so indentation survives', () => {
    const rendered = JSON.stringify(
      buildPeerlySlackErrorMessage({
        user,
        requestSummary: REQUEST_SUMMARY,
        responseData: RESPONSE_DATA,
      }),
    )

    expect(rendered).toContain('"type":"rich_text_preformatted"')
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
    const rendered = JSON.stringify(
      buildPeerlySlackErrorMessage({ user, errorMessage: 'socket hang up' }),
    )

    expect(rendered).toContain(quoted('socket hang up'))
    expect(rendered).not.toContain('undefined')
    // Nothing to preformat, so no empty code block either.
    expect(rendered).not.toContain('"type":"rich_text_preformatted"')
  })

  it('omits the bullet list entirely when there is nothing to bullet', () => {
    const rendered = JSON.stringify(
      buildPeerlySlackErrorMessage({ user, responseData: RESPONSE_DATA }),
    )

    // The user block still lists name/email/phone, so exactly one list remains.
    expect(countOf(rendered, '"type":"rich_text_list"')).toBe(1)
  })
})
