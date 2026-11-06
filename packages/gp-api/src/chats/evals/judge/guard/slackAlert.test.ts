import { describe, expect, it, vi } from 'vitest'
import { postPickerFailureAlert } from './slackAlert'

describe('postPickerFailureAlert', () => {
  it('does not post when the token is missing', async () => {
    const fetchImpl = vi.fn()
    const result = await postPickerFailureAlert(
      { token: undefined, channelId: 'C123' },
      'hello',
      fetchImpl,
    )
    expect(result.posted).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not post when the channel id is missing', async () => {
    const fetchImpl = vi.fn()
    const result = await postPickerFailureAlert(
      { token: 'xoxb-test', channelId: undefined },
      'hello',
      fetchImpl,
    )
    expect(result.posted).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('posts to chat.postMessage with a bearer token', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ json: async () => ({ ok: true }) })
    const result = await postPickerFailureAlert(
      { token: 'xoxb-test', channelId: 'C123' },
      'the picker failed twice',
      fetchImpl,
    )
    expect(result.posted).toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer xoxb-test',
        }),
      }),
    )
  })

  it('reports not posted when the Slack API answers ok: false', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: async () => ({ ok: false, error: 'invalid_auth' }),
    })
    const result = await postPickerFailureAlert(
      { token: 'xoxb-test', channelId: 'C123' },
      'x',
      fetchImpl,
    )
    expect(result.posted).toBe(false)
    expect(result.reason).toBe('invalid_auth')
  })
})
