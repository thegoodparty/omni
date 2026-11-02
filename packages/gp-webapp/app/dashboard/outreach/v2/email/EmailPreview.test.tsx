import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { api } from 'helpers/test-utils/api-mocking'
import { render } from 'helpers/test-utils/render'
import type { EmailContentDraft } from '@goodparty_org/contracts'
import { EMAIL_PREVIEW_DEBOUNCE_MS, EmailPreview } from './EmailPreview'

const content = (text: string): EmailContentDraft => ({
  layout: 'personal_letter',
  theme: 'classic_blue',
  subject: 'Town hall',
  blocks: [{ type: 'paragraph', text }],
})

const props = { serve: false, content: content('Hi') }

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

describe('EmailPreview', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the returned HTML in a sandboxed iframe without scripts', async () => {
    api.mock('POST /v1/outreach/email/preview', {
      status: 200,
      data: { html: '<p>Hi Alex</p>' },
    })
    render(<EmailPreview {...props} />)
    await advance(EMAIL_PREVIEW_DEBOUNCE_MS)

    const frame = await screen.findByTitle('Email preview')
    expect(frame).toHaveAttribute('srcdoc', '<p>Hi Alex</p>')
    expect(frame.getAttribute('sandbox') ?? '').not.toContain('allow-scripts')
  })

  it('requests one render after typing settles', async () => {
    const requests: unknown[] = []
    api.mock('POST /v1/outreach/email/preview', ({ body }) => {
      requests.push(body)
      return { status: 200, data: { html: '<p>ok</p>' } }
    })
    const { rerender } = render(<EmailPreview {...props} />)
    await advance(EMAIL_PREVIEW_DEBOUNCE_MS)
    await waitFor(() => expect(requests).toHaveLength(1))

    rerender(<EmailPreview {...props} content={content('Hi there')} />)
    await advance(EMAIL_PREVIEW_DEBOUNCE_MS - 100)
    rerender(
      <EmailPreview {...props} content={content('Hi there, neighbors')} />,
    )
    await advance(EMAIL_PREVIEW_DEBOUNCE_MS - 100)
    expect(requests).toHaveLength(1)

    await advance(200)
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]).toEqual({ content: content('Hi there, neighbors') })
  })

  it('waits while the blocks break a layout rule', async () => {
    const requests: unknown[] = []
    api.mock('POST /v1/outreach/email/preview', ({ body }) => {
      requests.push(body)
      return { status: 200, data: { html: '<p>ok</p>' } }
    })
    render(
      <EmailPreview
        serve={false}
        content={{
          ...content('Hi'),
          blocks: [{ type: 'heading', text: 'No headings here', level: 1 }],
        }}
      />,
    )
    await advance(EMAIL_PREVIEW_DEBOUNCE_MS * 2)
    expect(requests).toHaveLength(0)
  })

  it('calls the Serve route in Serve', async () => {
    const requests: unknown[] = []
    api.mock('POST /v1/outreach/serve/email/preview', ({ body }) => {
      requests.push(body)
      return { status: 200, data: { html: '<p>serve</p>' } }
    })
    render(<EmailPreview {...props} serve />)
    await advance(EMAIL_PREVIEW_DEBOUNCE_MS)
    await waitFor(() => expect(requests).toHaveLength(1))
  })

  it('keeps the last good render and shows an error when an update fails', async () => {
    api.mock('POST /v1/outreach/email/preview', {
      status: 200,
      data: { html: '<p>first</p>' },
    })
    const { rerender } = render(<EmailPreview {...props} />)
    await advance(EMAIL_PREVIEW_DEBOUNCE_MS)
    await screen.findByTitle('Email preview')

    api.mock('POST /v1/outreach/email/preview', {
      status: 400,
      data: { message: 'Upload the image through the email composer' },
    })
    rerender(<EmailPreview {...props} content={content('Changed')} />)
    await advance(EMAIL_PREVIEW_DEBOUNCE_MS)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Upload the image through the email composer',
    )
    expect(screen.getByTitle('Email preview')).toHaveAttribute(
      'srcdoc',
      '<p>first</p>',
    )
  })

  it('shows the answer to the latest edit even when an older one lands later', async () => {
    const releases: Array<() => void> = []
    api.mock('POST /v1/outreach/email/preview', async ({ body }) => {
      const text = JSON.stringify(body)
      await new Promise<void>((resolve) => releases.push(resolve))
      return {
        status: 200,
        data: { html: `<p>${text.includes('three') ? 'three' : 'older'}</p>` },
      }
    })
    const { rerender } = render(<EmailPreview {...props} />)
    await advance(EMAIL_PREVIEW_DEBOUNCE_MS)
    rerender(<EmailPreview {...props} content={content('two')} />)
    await advance(EMAIL_PREVIEW_DEBOUNCE_MS)
    rerender(<EmailPreview {...props} content={content('three')} />)
    await advance(EMAIL_PREVIEW_DEBOUNCE_MS)
    await waitFor(() => expect(releases).toHaveLength(3))

    releases[2]?.()
    await waitFor(() =>
      expect(screen.getByTitle('Email preview')).toHaveAttribute(
        'srcdoc',
        '<p>three</p>',
      ),
    )
    releases[0]?.()
    releases[1]?.()
    await advance(50)
    expect(screen.getByTitle('Email preview')).toHaveAttribute(
      'srcdoc',
      '<p>three</p>',
    )
  })

  it('shows an older answer while a slow render is still pending', async () => {
    const releases: Array<() => void> = []
    api.mock('POST /v1/outreach/email/preview', async () => {
      await new Promise<void>((resolve) => releases.push(resolve))
      return { status: 200, data: { html: '<p>done</p>' } }
    })
    const { rerender } = render(<EmailPreview {...props} />)
    await advance(EMAIL_PREVIEW_DEBOUNCE_MS)
    rerender(<EmailPreview {...props} content={content('two')} />)
    await advance(EMAIL_PREVIEW_DEBOUNCE_MS)
    await waitFor(() => expect(releases).toHaveLength(2))

    releases[0]?.()
    expect(await screen.findByTitle('Email preview')).toHaveAttribute(
      'srcdoc',
      '<p>done</p>',
    )
  })

  it('keeps refreshing while a button link is half typed', async () => {
    const requests: unknown[] = []
    api.mock('POST /v1/outreach/email/preview', ({ body }) => {
      requests.push(body)
      return { status: 200, data: { html: '<p>ok</p>' } }
    })
    render(
      <EmailPreview
        serve={false}
        content={{
          ...content('Hi'),
          blocks: [
            { type: 'paragraph', text: 'Hi' },
            { type: 'button', label: 'Go', url: 'http' },
          ],
        }}
      />,
    )
    await advance(EMAIL_PREVIEW_DEBOUNCE_MS)
    await waitFor(() => expect(requests).toHaveLength(1))
  })
})
