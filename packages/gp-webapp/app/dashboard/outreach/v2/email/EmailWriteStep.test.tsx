import { useState } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from 'helpers/test-utils/api-mocking'
import { render } from 'helpers/test-utils/render'
import { EmailWriteStep } from './EmailWriteStep'
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

// Dictation reaches for getUserMedia, which jsdom has not got. The mock keeps
// the transcript callback so a test can play a finished utterance into it.
const dictation: { onFinalTranscript: ((text: string) => void) | null } = {
  onFinalTranscript: null,
}
vi.mock('app/dashboard/shared/dictation/useDictation', () => ({
  useDictation: (input: { onFinalTranscript: (text: string) => void }) => {
    dictation.onFinalTranscript = input.onFinalTranscript
    return {
      status: 'idle',
      error: null,
      partialTranscript: '',
      start: vi.fn(),
      stop: vi.fn(),
    }
  },
}))

const Harness = ({
  surface = WIN_EMAIL_SURFACE,
  start,
  showIssues = false,
  continuePresses = 0,
  serverError = null,
}: {
  surface?: typeof WIN_EMAIL_SURFACE
  start: EmailComposeState
  showIssues?: boolean
  continuePresses?: number
  serverError?: ComposeFieldError | null
}) => {
  const [value, setValue] = useState(start)
  return (
    <EmailWriteStep
      surface={surface}
      value={value}
      onChange={setValue}
      showIssues={showIssues}
      continuePresses={continuePresses}
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

describe('EmailWriteStep AI draft', () => {
  it.each<[string, typeof WIN_EMAIL_SURFACE, DraftRoute]>([
    ['Win', WIN_EMAIL_SURFACE, 'POST /v1/outreach/email/draft'],
    ['Serve', SERVE_EMAIL_SURFACE, 'POST /v1/outreach/serve/email/draft'],
  ])(
    'fills the form once on entering the step (%s)',
    async (_name, surface, route) => {
      const requests: unknown[] = []
      mockDraft(route, requests)
      render(<Harness surface={surface} start={initialCompose()} />)

      await waitFor(() =>
        expect(screen.getByLabelText('Subject')).toHaveValue(
          'Meet your neighbor',
        ),
      )
      // The message editor syncs from the form a render after Subject.
      await waitFor(() => expect(message()).toHaveTextContent('I am running.'))
      expect(screen.getByLabelText('Headline')).toHaveValue('')
      expect(screen.queryByLabelText('Button text')).toBeNull()
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

  it('replaces edited content on Regenerate right away, and can undo', async () => {
    const requests: unknown[] = []
    mockDraft('POST /v1/outreach/email/draft', requests)
    const user = userEvent.setup()
    render(<Harness start={written} />)

    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Subject')).toHaveValue(
        'Meet your neighbor',
      ),
    )
    // The draft had no headline, so the title the user wrote stays.
    expect(screen.getByLabelText('Headline')).toHaveValue('Ward 2 update')
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByLabelText('Subject')).toHaveValue('October')
  })
})

describe('EmailWriteStep tone', () => {
  it('waits while the first draft loads, then rewrites in the picked tone', async () => {
    let release: () => void = () => undefined
    const requests: unknown[] = []
    api.mock('POST /v1/outreach/email/draft', async ({ body }) => {
      requests.push(body)
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { status: 200, data: AI_DRAFT }
    })
    const user = userEvent.setup()
    render(<Harness start={initialCompose()} />)

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(screen.getByRole('radio', { name: 'Direct' })).toBeDisabled()
    release()
    await waitFor(() => expect(message()).toHaveTextContent('I am running.'))

    await user.click(screen.getByRole('radio', { name: 'Direct' }))
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]).toMatchObject({ tone: 'direct' })
    expect(screen.getByRole('radio', { name: 'Direct' })).toBeChecked()
  })

  it('keeps the tone when edited writing can’t be improved', async () => {
    const requests: unknown[] = []
    mockDraft('POST /v1/outreach/email/draft', requests)
    const user = userEvent.setup()
    render(<Harness start={{ ...written, subject: '' }} />)

    const direct = screen.getByRole('radio', { name: 'Direct' })
    expect(direct).toBeDisabled()
    await user.click(direct)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(requests).toHaveLength(0)
    expect(screen.getByRole('radio', { name: 'Warm' })).toBeChecked()
  })
})

describe('EmailWriteStep form', () => {
  it('shows Title and the subheading hint in every layout', async () => {
    const { unmount } = render(<Harness start={written} />)

    expect(screen.getByLabelText('Headline')).toHaveValue('Ward 2 update')
    expect(
      screen.getByText('Start a line with ## to add a subheading.'),
    ).toBeInTheDocument()
    unmount()

    render(<Harness start={switchLayout(written, 'personal_letter')} />)
    expect(screen.getByLabelText('Headline')).toHaveValue('Ward 2 update')
    expect(
      screen.getByText('Start a line with ## to add a subheading.'),
    ).toBeInTheDocument()
    expect(message()).toHaveTextContent('It moved to December.')
  })

  it('shows plain errors next to the field, leaving the button to the look step', async () => {
    render(
      <Harness
        showIssues
        start={{
          ...switchLayout(initialCompose(), 'short_cta'),
          message: 'a'.repeat(601),
          buttonLabel: 'Sign up',
        }}
      />,
    )

    expect(screen.getByText('Add a subject line.')).toBeInTheDocument()
    expect(screen.queryByText('Write your message.')).toBeNull()
    expect(screen.queryByText('Add the link this button opens.')).toBeNull()
  })

  it('puts a refused send’s error on its field', async () => {
    render(
      <Harness
        start={written}
        serverError={{ field: 'message', message: 'Keep this to one line.' }}
      />,
    )

    expect(screen.getByText('Keep this to one line.')).toBeInTheDocument()
    expect(message()).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows the form as blocks on the Preview tab', async () => {
    const user = userEvent.setup()
    render(<Harness start={written} />)

    expect(screen.queryByTestId('email-preview')).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    expect(screen.getByTestId('email-preview')).toBeInTheDocument()
    await waitFor(() => expect(previews.length).toBeGreaterThan(0), {
      timeout: 2000,
    })
    expect(previews.at(-1)).toEqual({
      content: {
        layout: 'long_update',
        theme: 'neutral',
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

describe('EmailWriteStep preview', () => {
  const start: EmailComposeState = {
    ...switchLayout(initialCompose(), 'short_cta'),
    subject: 'October',
    title: 'Ward 2 update',
    message: 'Dear neighbor',
    photoUrl: 'https://assets.example.com/a.png',
    buttonLabel: 'RSVP',
    buttonUrl: 'https://example.org/rsvp',
  }

  const openPreview = async (user: ReturnType<typeof userEvent.setup>) => {
    render(<Harness start={start} />)
    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    await waitFor(() => expect(previews.length).toBeGreaterThan(0))
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  it.each<
    [string, (user: ReturnType<typeof userEvent.setup>) => Promise<void>]
  >([
    ['subject', (u) => u.type(screen.getByLabelText('Subject'), '!')],
    ['title', (u) => u.type(screen.getByLabelText('Headline'), '!')],
    ['message', (u) => u.type(message(), '!')],
    [
      'photo',
      (u) => u.click(screen.getByRole('button', { name: 'Remove photo' })),
    ],
  ])(
    'renders the edited %s when Preview is opened again',
    async (_name, edit) => {
      const user = userEvent.setup()
      await openPreview(user)
      const before = previews.length
      await user.click(screen.getByRole('tab', { name: 'Write' }))
      await edit(user)
      await user.click(screen.getByRole('tab', { name: 'Preview' }))
      await waitFor(() => expect(previews.length).toBeGreaterThan(before))
    },
  )

  it('goes back to Write when Continue finds a problem', async () => {
    const user = userEvent.setup()
    const empty = { ...start, message: '' }
    const { rerender } = render(<Harness start={empty} />)
    await user.click(screen.getByRole('tab', { name: 'Preview' }))

    rerender(<Harness start={empty} showIssues continuePresses={1} />)
    expect(screen.getByRole('tab', { name: 'Write' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByText('Write your message.')).toBeInTheDocument()
  })

  it('puts dictation into the message while Preview is open', async () => {
    const user = userEvent.setup()
    await openPreview(user)
    act(() => dictation.onFinalTranscript?.('Vote early.'))
    await user.click(screen.getByRole('tab', { name: 'Write' }))
    expect(message()).toHaveTextContent('Vote early.')
  })

  it('keeps Subject and Headline in view while the message is previewed', async () => {
    const user = userEvent.setup()
    await openPreview(user)
    expect(screen.getByLabelText('Subject')).toHaveValue('October')
    expect(screen.getByLabelText('Headline')).toHaveValue('Ward 2 update')
    expect(screen.queryByTestId('email-preview-subject')).toBeNull()
  })
})

describe('EmailWriteStep photo', () => {
  const photoUrl = 'https://assets.example.com/email-images/org/abc.png'
  const withPhoto = { ...initialCompose(), subject: 'October', photoUrl }

  it('shows the photo the form already holds when the step opens again', () => {
    render(<Harness start={withPhoto} />)

    expect(screen.getByLabelText('Photo (optional)')).toHaveAttribute(
      'type',
      'file',
    )
    expect(screen.getByAltText('Photo preview')).toHaveAttribute(
      'src',
      photoUrl,
    )
    expect(screen.getByAltText('Photo preview')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Replace photo' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Add photo' }),
    ).not.toBeInTheDocument()
  })

  it('moves the photo below the message and back', async () => {
    const user = userEvent.setup()
    render(<Harness start={withPhoto} />)
    const below = () =>
      Boolean(
        screen
          .getByRole('textbox', { name: 'Message' })
          .compareDocumentPosition(screen.getByAltText('Photo preview')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      )

    expect(below()).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Move to bottom' }))
    expect(below()).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Move to top' }))
    expect(below()).toBe(false)
  })

  it('opens the file picker from anywhere on the photo box', async () => {
    const user = userEvent.setup()
    render(<Harness start={withPhoto} />)
    const picker = vi.spyOn(
      screen.getByLabelText('Photo (optional)') as HTMLInputElement,
      'click',
    )

    await user.click(screen.getByAltText('Photo preview'))
    expect(picker).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Move to bottom' }))
    expect(picker).toHaveBeenCalledTimes(1)
  })

  it('offers Add photo again after the photo is removed', async () => {
    const user = userEvent.setup()
    render(<Harness start={withPhoto} />)

    await user.click(screen.getByRole('button', { name: 'Remove photo' }))

    expect(screen.queryByAltText('Photo preview')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Add photo' }),
    ).toBeInTheDocument()
  })
})
