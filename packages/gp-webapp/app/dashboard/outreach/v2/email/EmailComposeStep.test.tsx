import { useState } from 'react'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from 'helpers/test-utils/api-mocking'
import { render } from 'helpers/test-utils/render'
import { EmailComposeStep } from './EmailComposeStep'
import {
  initialCompose,
  switchLayout,
  type ComposeFieldError,
  type EmailComposeState,
} from './emailForm.util'
import { SERVE_EMAIL_SURFACE, WIN_EMAIL_SURFACE } from './emailSurface'

const AI_DRAFT = {
  subject: 'Meet your neighbor',
  headline: null,
  body: 'Hi {{first_name}},\n\nI am running.',
  buttonLabel: 'Say hello',
  content: {
    layout: 'personal_letter' as const,
    theme: 'cream_and_forest' as const,
    subject: 'Meet your neighbor',
    blocks: [
      { type: 'paragraph' as const, text: 'Hi {{first_name}},' },
      { type: 'paragraph' as const, text: 'I am running.' },
      { type: 'button' as const, label: 'Say hello', url: '' },
    ],
  },
}

const Harness = ({
  surface = WIN_EMAIL_SURFACE,
  start,
  showIssues = false,
  serverError = null,
}: {
  surface?: typeof WIN_EMAIL_SURFACE
  start: EmailComposeState
  showIssues?: boolean
  serverError?: ComposeFieldError | null
}) => {
  const [value, setValue] = useState(start)
  return (
    <EmailComposeStep
      surface={surface}
      value={value}
      onChange={setValue}
      showIssues={showIssues}
      goal="Introduce myself"
      serverError={serverError}
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

const previews: unknown[] = []

beforeEach(() => {
  previews.length = 0
  api.mock('POST /v1/outreach/email/preview', ({ body }) => {
    previews.push(body)
    return { status: 200, data: { html: '<p>ok</p>' } }
  })
  api.mock('POST /v1/outreach/serve/email/preview', {
    status: 200,
    data: { html: '<p>ok</p>' },
  })
})

// Typing into the message field scrolls to the cursor, which jsdom cannot
// measure.
beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [],
  })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(),
  })
})

const message = () => screen.getByRole('textbox', { name: 'Message' })

const written: EmailComposeState = {
  ...switchLayout(initialCompose(), 'long_update'),
  subject: 'October',
  title: 'Ward 2 update',
  message: 'Dear neighbor,\n\n## The vote\nIt moved to December.',
}

describe('EmailComposeStep AI draft', () => {
  it.each<[string, typeof WIN_EMAIL_SURFACE, DraftRoute]>([
    ['Win', WIN_EMAIL_SURFACE, 'POST /v1/outreach/email/draft'],
    ['Serve', SERVE_EMAIL_SURFACE, 'POST /v1/outreach/serve/email/draft'],
  ])(
    'fills the form once on entering compose (%s)',
    async (_name, surface, route) => {
      const requests: unknown[] = []
      mockDraft(route, requests)
      render(<Harness surface={surface} start={initialCompose()} />)

      await waitFor(() =>
        expect(screen.getByLabelText('Subject')).toHaveValue(
          'Meet your neighbor',
        ),
      )
      expect(message()).toHaveTextContent('I am running.')
      expect(screen.queryByLabelText('Title')).toBeNull()
      expect(screen.getByLabelText('Button text')).toHaveValue('Say hello')
      expect(screen.getByTestId('email-link-prompt')).toBeInTheDocument()
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({ layout: 'personal_letter' })
    },
  )

  it('does not request a draft when content already exists', async () => {
    const requests: unknown[] = []
    mockDraft('POST /v1/outreach/email/draft', requests)
    render(<Harness start={written} />)

    expect(await screen.findByLabelText('Subject')).toHaveValue('October')
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
    render(<Harness start={initialCompose()} />)

    await userEvent.setup().type(await screen.findByLabelText('Subject'), 'Hi')
    await waitFor(() => expect(requests).toHaveLength(1))
    release()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByLabelText('Subject')).toHaveValue('Hi')
    expect(message()).not.toHaveTextContent('I am running.')
  })

  it('asks before Regenerate replaces edited content, and can undo', async () => {
    const requests: unknown[] = []
    mockDraft('POST /v1/outreach/email/draft', requests)
    const user = userEvent.setup()
    render(<Harness start={written} />)

    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(screen.getByTestId('email-regenerate-confirm')).toBeInTheDocument()
    expect(requests).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Replace' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Subject')).toHaveValue(
        'Meet your neighbor',
      ),
    )
    // The draft had no headline, so the title the user wrote stays.
    expect(screen.getByLabelText('Title')).toHaveValue('Ward 2 update')
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByLabelText('Subject')).toHaveValue('October')
  })
})

describe('EmailComposeStep form', () => {
  it('shows Title and the subheading hint only where the layout uses them', async () => {
    const user = userEvent.setup()
    render(<Harness start={written} />)

    expect(screen.getByLabelText('Title')).toHaveValue('Ward 2 update')
    expect(
      screen.getByText('Start a line with ## to add a subheading.'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Personal letter' }))
    expect(screen.queryByLabelText('Title')).toBeNull()
    expect(
      screen.queryByText('Start a line with ## to add a subheading.'),
    ).toBeNull()

    await user.click(screen.getByRole('radio', { name: 'Short with a button' }))
    expect(screen.getByLabelText('Title')).toHaveValue('Ward 2 update')
    expect(message()).toHaveTextContent('It moved to December.')
    expect(screen.getByLabelText('Subject')).toHaveValue('October')
  })

  it('shows plain errors next to the field', async () => {
    render(
      <Harness
        showIssues
        start={{
          ...switchLayout(initialCompose(), 'short_cta'),
          subject: 'Saturday',
          message: 'a'.repeat(601),
          buttonLabel: 'Sign up',
        }}
      />,
    )

    expect(screen.getByText('Add a title.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Keep the message under 600 characters for this layout.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Add the link this button opens.'),
    ).toBeInTheDocument()
  })

  it('puts a refused send’s error on its field', async () => {
    render(
      <Harness
        start={{ ...written, buttonLabel: 'Read', buttonUrl: 'https://x.co' }}
        serverError={{ field: 'button', message: 'Keep this to one line.' }}
      />,
    )

    expect(screen.getByText('Keep this to one line.')).toBeInTheDocument()
  })

  it('offers Top or Bottom for a personal letter’s photo', async () => {
    const user = userEvent.setup()
    render(
      <Harness
        start={{
          ...initialCompose(),
          subject: 'Hi',
          message: 'Hello',
          photoUrl: 'https://assets.example.com/a.png',
        }}
      />,
    )

    await user.click(screen.getByRole('radio', { name: 'Bottom' }))
    await waitFor(
      () =>
        expect(previews.at(-1)).toMatchObject({
          content: {
            blocks: [
              { type: 'paragraph', text: 'Hello' },
              { type: 'image', url: 'https://assets.example.com/a.png' },
            ],
          },
        }),
      { timeout: 2000 },
    )
  })

  it('previews the form as blocks', async () => {
    render(<Harness start={written} />)

    await waitFor(() => expect(previews.length).toBeGreaterThan(0), {
      timeout: 2000,
    })
    expect(previews.at(-1)).toEqual({
      content: {
        layout: 'long_update',
        theme: 'classic_blue',
        subject: 'October',
        blocks: [
          { type: 'heading', text: 'Ward 2 update', level: 1 },
          { type: 'paragraph', text: 'Dear neighbor,' },
          { type: 'heading', text: 'The vote', level: 2 },
          { type: 'paragraph', text: 'It moved to December.' },
        ],
      },
    })
  })
})
