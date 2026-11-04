import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from 'helpers/test-utils/api-mocking'
import { render } from 'helpers/test-utils/render'
import { EmailLookStep } from './EmailLookStep'
import {
  initialCompose,
  switchLayout,
  type ComposeFieldError,
  type EmailComposeState,
} from './emailForm.util'
import { WIN_EMAIL_SURFACE } from './emailSurface'

const Harness = ({
  start,
  showIssues = false,
  serverError = null,
}: {
  start: EmailComposeState
  showIssues?: boolean
  serverError?: ComposeFieldError | null
}) => {
  const [value, setValue] = useState(start)
  return (
    <EmailLookStep
      surface={WIN_EMAIL_SURFACE}
      value={value}
      onChange={setValue}
      showIssues={showIssues}
      serverError={serverError}
    />
  )
}

const previews: unknown[] = []

beforeEach(() => {
  previews.length = 0
  api.mock('POST /v1/outreach/email/preview', ({ body }) => {
    previews.push(body)
    return { status: 200, data: { html: '<p>ok</p>' } }
  })
})

const letter: EmailComposeState = {
  ...initialCompose(),
  subject: 'Hi',
  message: 'Hello',
}

describe('EmailLookStep', () => {
  it('keeps the button optional and the writing valid in every layout', async () => {
    const user = userEvent.setup()
    render(
      <Harness showIssues start={{ ...letter, message: 'a'.repeat(601) }} />,
    )

    for (const name of ['Short', 'Long update']) {
      await user.click(screen.getByRole('radio', { name }))
      expect(screen.getByText('Button (optional)')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).toBeNull()
    }
  })

  it('hides the button fields until Add a button', async () => {
    const user = userEvent.setup()
    render(<Harness start={letter} />)

    expect(screen.queryByLabelText('Button text')).toBeNull()
    expect(screen.queryByLabelText('Button link')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Add a button' }))
    expect(screen.getByLabelText('Button text')).toBeInTheDocument()
    expect(screen.getByLabelText('Button link')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add a button' })).toBeNull()
  })

  it('opens with the button shown when it already has text', () => {
    render(<Harness start={{ ...letter, buttonLabel: 'Sign up' }} />)

    expect(screen.getByLabelText('Button text')).toHaveValue('Sign up')
    expect(screen.queryByRole('button', { name: 'Add a button' })).toBeNull()
  })

  it('clears the text and link when the button is removed', async () => {
    const user = userEvent.setup()
    render(
      <Harness
        start={{ ...letter, buttonLabel: 'Sign up', buttonUrl: 'https://x.co' }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Remove button' }))
    expect(screen.queryByLabelText('Button text')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Add a button' }))
    expect(screen.getByLabelText('Button text')).toHaveValue('')
    expect(screen.getByLabelText('Button link')).toHaveValue('')
  })

  it('asks for the button’s link, and shows the button error after Next', async () => {
    const { unmount } = render(
      <Harness start={{ ...letter, buttonLabel: 'Say hello' }} />,
    )
    expect(screen.getByTestId('email-link-prompt')).toBeInTheDocument()
    unmount()

    render(
      <Harness
        showIssues
        start={{
          ...switchLayout(letter, 'short_cta'),
          title: 'Saturday',
          buttonLabel: 'Sign up',
        }}
      />,
    )
    expect(
      screen.getByText('Add the link this button opens.'),
    ).toBeInTheDocument()
  })

  it('shows a bad button link as soon as it is typed', async () => {
    render(
      <Harness
        start={{ ...letter, buttonLabel: 'Sign up', buttonUrl: 'example.org' }}
      />,
    )

    expect(screen.queryByTestId('email-link-prompt')).toBeNull()
    expect(screen.getByTestId('email-button')).toHaveTextContent(/https:\/\//)
  })

  it('puts a refused send’s button error on the button', async () => {
    render(
      <Harness
        start={{ ...letter, buttonLabel: 'Read', buttonUrl: 'https://x.co' }}
        serverError={{ field: 'button', message: 'Keep this to one line.' }}
      />,
    )

    expect(screen.getByText('Keep this to one line.')).toBeInTheDocument()
  })

  it('offers Top or Bottom for a personal letter’s photo', async () => {
    const user = userEvent.setup()
    render(
      <Harness
        start={{ ...letter, photoUrl: 'https://assets.example.com/a.png' }}
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

    await user.click(screen.getByRole('radio', { name: 'Long update' }))
    expect(screen.queryByRole('radio', { name: 'Bottom' })).toBeNull()
  })
})

describe('EmailLookStep preview', () => {
  const start: EmailComposeState = {
    ...switchLayout(initialCompose(), 'short_cta'),
    subject: 'October',
    title: 'Ward 2 update',
    message: 'Dear neighbor',
    photoUrl: 'https://assets.example.com/a.png',
    buttonLabel: 'RSVP',
    buttonUrl: 'https://example.org/rsvp',
  }

  const settled = async () => {
    await waitFor(() => expect(previews.length).toBeGreaterThan(0))
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  it.each<
    [string, (user: ReturnType<typeof userEvent.setup>) => Promise<void>]
  >([
    ['button text', (u) => u.type(screen.getByLabelText('Button text'), '!')],
    ['button link', (u) => u.type(screen.getByLabelText('Button link'), 'x')],
    [
      'layout',
      (u) => u.click(screen.getByRole('radio', { name: 'Personal letter' })),
    ],
    [
      'theme',
      (u) => u.click(screen.getAllByRole('button', { pressed: false })[0]!),
    ],
  ])('refreshes after a change to the %s', async (_name, edit) => {
    const user = userEvent.setup()
    render(<Harness start={start} />)
    await settled()
    const before = previews.length
    await edit(user)
    await waitFor(() => expect(previews.length).toBeGreaterThan(before))
  })

  it('ends on the last of several quick edits', async () => {
    const user = userEvent.setup()
    render(<Harness start={start} />)
    await settled()
    await user.type(screen.getByLabelText('Button text'), ' one')
    await user.click(screen.getAllByRole('button', { pressed: false })[0]!)
    await user.type(screen.getByLabelText('Button text'), ' two')
    await waitFor(() => {
      const last = JSON.stringify(previews[previews.length - 1])
      expect(last).toContain('RSVP one two')
    })
  })
})
