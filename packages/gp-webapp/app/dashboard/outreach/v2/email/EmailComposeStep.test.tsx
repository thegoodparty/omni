import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from 'helpers/test-utils/api-mocking'
import { render } from 'helpers/test-utils/render'
import { EmailComposeStep } from './EmailComposeStep'
import { initialCompose, type EmailComposeState } from './emailFlow.util'
import { SERVE_EMAIL_SURFACE, WIN_EMAIL_SURFACE } from './emailSurface'

const AI_DRAFT = {
  subject: 'Meet your neighbor',
  headline: 'Hello',
  body: 'Hi, I am running.',
  buttonLabel: null,
}

const Harness = ({
  surface,
  start,
}: {
  surface: typeof WIN_EMAIL_SURFACE
  start: EmailComposeState
}) => {
  const [value, setValue] = useState(start)
  return (
    <EmailComposeStep
      surface={surface}
      value={value}
      onChange={setValue}
      issues={{}}
      showIssues={false}
      senderName="Sam"
      goal="Introduce myself"
    />
  )
}

type DraftRoute =
  | 'POST /v1/outreach/email/draft'
  | 'POST /v1/outreach/serve/email/draft'

const mockDraft = (route: DraftRoute, requests: unknown[]) =>
  api.mock(route, ({ body }) => {
    requests.push(body)
    return { status: 200, data: AI_DRAFT }
  })

describe('EmailComposeStep auto draft', () => {
  it.each<[string, typeof WIN_EMAIL_SURFACE, DraftRoute]>([
    ['Win', WIN_EMAIL_SURFACE, 'POST /v1/outreach/email/draft'],
    ['Serve', SERVE_EMAIL_SURFACE, 'POST /v1/outreach/serve/email/draft'],
  ])(
    'requests one draft on entering compose with it empty (%s)',
    async (_name, surface, route) => {
      const requests: unknown[] = []
      mockDraft(route, requests)
      render(<Harness surface={surface} start={initialCompose} />)

      await waitFor(() =>
        expect(screen.getByLabelText('Subject')).toHaveValue(
          'Meet your neighbor',
        ),
      )
      expect(requests).toHaveLength(1)
    },
  )

  it('does not request a draft when content already exists', async () => {
    const requests: unknown[] = []
    mockDraft('POST /v1/outreach/email/draft', requests)
    render(
      <Harness
        surface={WIN_EMAIL_SURFACE}
        start={{ ...initialCompose, subject: 'Mine', body: 'My words' }}
      />,
    )

    expect(await screen.findByLabelText('Subject')).toHaveValue('Mine')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(requests).toHaveLength(0)
  })

  it('keeps what the user typed when the draft lands late', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const requests: unknown[] = []
    api.mock('POST /v1/outreach/email/draft', async ({ body }) => {
      requests.push(body)
      await gate
      return { status: 200, data: AI_DRAFT }
    })
    render(<Harness surface={WIN_EMAIL_SURFACE} start={initialCompose} />)

    await userEvent.setup().type(await screen.findByLabelText('Subject'), 'Hi')
    await waitFor(() => expect(requests).toHaveLength(1))
    release()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByLabelText('Subject')).toHaveValue('Hi')
  })
})
