import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import type { EmailSend } from '@goodparty_org/contracts'
import { api } from 'helpers/test-utils/api-mocking'
import { render } from 'helpers/test-utils/render'
import { EmailDrawerSections } from './EmailDrawerSections'

const content = {
  layout: 'long_update' as const,
  theme: 'classic_blue' as const,
  subject: 'October update',
  blocks: [{ type: 'paragraph' as const, text: 'Hi there' }],
}

const send = (over: Partial<EmailSend> = {}): EmailSend => ({
  id: 11,
  status: 'completed',
  goal: 'Hello',
  layout: 'newsletter',
  theme: 'classic_blue',
  subject: 'October update',
  headline: null,
  body: 'Hi',
  imageUrl: null,
  buttonLabel: null,
  buttonUrl: null,
  paidForBy: null,
  date: '2026-11-03T18:00:00.000Z',
  voterFileFilterId: 1,
  recipientCount: 200,
  recipientCap: 200,
  priceCents: 200,
  sentCount: 200,
  pauseReason: null,
  stopping: false,
  cardDeclined: false,
  estimate: null,
  deliveryCounts: {
    sent: 200,
    delivered: 190,
    bounced: 10,
    complained: 1,
    opened: 80,
    clicked: 12,
  },
  content,
  ...over,
})

describe('EmailDrawerSections', () => {
  it('shows the delivery numbers and the email with its subject', async () => {
    api.mock('GET /v1/outreach/email/:id', { status: 200, data: send() })
    api.mock('POST /v1/outreach/email/preview', {
      status: 200,
      data: { html: '<p>Hi there</p>' },
    })
    render(<EmailDrawerSections id={11} isServe={false} />)

    const stats = await screen.findByTestId('email-drawer-statistics')
    expect(stats).toHaveTextContent('Based on 200 emails sent')
    expect(stats).toHaveTextContent('Delivered19095%')
    expect(stats).toHaveTextContent('Opened (approximate)8040%')
    expect(stats).toHaveTextContent('Marked as spam11%')
    expect(screen.getByTestId('email-preview-subject')).toHaveTextContent(
      'Subject: October update',
    )
    expect(await screen.findByTitle('Email preview')).toBeInTheDocument()
  })

  it('leaves the numbers out before anything has gone out', async () => {
    api.mock('GET /v1/outreach/email/:id', {
      status: 200,
      data: send({ status: 'pending', sentCount: 0, deliveryCounts: null }),
    })
    api.mock('POST /v1/outreach/email/preview', {
      status: 200,
      data: { html: '<p>Hi there</p>' },
    })
    render(<EmailDrawerSections id={11} isServe={false} />)

    expect(await screen.findByTitle('Email preview')).toBeInTheDocument()
    expect(screen.queryByTestId('email-drawer-statistics')).toBeNull()
  })
})
