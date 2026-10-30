import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from 'helpers/test-utils/api-mocking'
import { render } from 'helpers/test-utils/render'
import { EmailComposeStep } from './EmailComposeStep'
import {
  initialCompose,
  starterCompose,
  withIds,
  type BlockError,
  type EmailComposeState,
} from './emailBlocks.util'
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
  serverError?: BlockError | null
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

const cards = () => screen.getAllByTestId('email-block')
const cardTypes = () => cards().map((card) => card.dataset.blockType)

const written: EmailComposeState = {
  ...starterCompose('long_update'),
  subject: 'October',
  blocks: withIds([
    { type: 'heading', text: 'Ward 2 update', level: 1 },
    { type: 'paragraph', text: 'Dear neighbor,' },
    { type: 'heading', text: 'The vote', level: 2 },
    { type: 'paragraph', text: 'It moved to December.' },
    { type: 'divider' },
  ]),
}

describe('EmailComposeStep AI draft', () => {
  it.each<[string, typeof WIN_EMAIL_SURFACE, DraftRoute]>([
    ['Win', WIN_EMAIL_SURFACE, 'POST /v1/outreach/email/draft'],
    ['Serve', SERVE_EMAIL_SURFACE, 'POST /v1/outreach/serve/email/draft'],
  ])(
    'fills the blocks once on entering compose (%s)',
    async (_name, surface, route) => {
      const requests: unknown[] = []
      mockDraft(route, requests)
      render(<Harness surface={surface} start={initialCompose()} />)

      await waitFor(() =>
        expect(screen.getByLabelText('Subject')).toHaveValue(
          'Meet your neighbor',
        ),
      )
      expect(cardTypes()).toEqual(['paragraph', 'paragraph', 'button'])
      expect(screen.getByLabelText('Button text')).toHaveValue('Say hello')
      expect(screen.getByTestId('email-link-prompt')).toBeInTheDocument()
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
    expect(cardTypes()).toEqual(['paragraph', 'paragraph', 'paragraph'])
  })

  it('asks before Regenerate replaces edited content', async () => {
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
    // The draft was for a long update, so it is fitted to that layout.
    expect(cardTypes()[0]).toBe('heading')
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByLabelText('Subject')).toHaveValue('October')
  })
})

describe('EmailComposeStep blocks', () => {
  it('adds, moves and removes blocks within the layout rules', async () => {
    const user = userEvent.setup()
    render(<Harness start={written} />)

    const add = within(screen.getByTestId('email-add-block'))
    expect(add.queryByRole('button', { name: 'Headline' })).toBeNull()
    await user.click(add.getByRole('button', { name: 'Photo' }))
    expect(cardTypes()).toEqual([
      'heading',
      'image',
      'paragraph',
      'heading',
      'paragraph',
      'divider',
    ])
    // Only one photo, right after the headline.
    expect(add.queryByRole('button', { name: 'Photo' })).toBeNull()

    const photo = screen.getByRole('group', { name: 'Photo' })
    expect(
      within(photo).getByRole('button', { name: 'Move photo down' }),
    ).toBeDisabled()
    const headline = screen.getByRole('group', { name: 'Headline' })
    expect(
      within(headline).getByRole('button', { name: 'Remove headline' }),
    ).toBeDisabled()

    const divider = screen.getByRole('group', { name: 'Divider' })
    await user.click(
      within(divider).getByRole('button', { name: 'Move divider up' }),
    )
    expect(cardTypes().slice(-2)).toEqual(['divider', 'paragraph'])

    await user.click(
      within(screen.getByRole('group', { name: 'Divider' })).getByRole(
        'button',
        { name: 'Remove divider' },
      ),
    )
    expect(cardTypes()).not.toContain('divider')
  })

  it('keeps the text when switching layouts, and can undo', async () => {
    const user = userEvent.setup()
    render(<Harness start={written} />)

    await user.click(screen.getByRole('radio', { name: 'Personal letter' }))
    expect(cardTypes()).toEqual([
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
    ])
    expect(screen.getByTestId('email-change-notice')).toHaveTextContent(
      'Switched to Personal letter.',
    )
    expect(screen.getByTestId('email-change-notice')).toHaveTextContent(
      '1 divider',
    )

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(cardTypes()).toEqual([
      'heading',
      'paragraph',
      'heading',
      'paragraph',
      'divider',
    ])
    expect(screen.getByRole('textbox', { name: 'Headline' })).toHaveValue(
      'Ward 2 update',
    )
  })

  it('shows plain errors next to the block', async () => {
    render(
      <Harness
        showIssues
        start={{
          ...starterCompose('short_cta'),
          subject: 'Saturday',
          blocks: withIds([
            { type: 'heading', text: 'Knock doors', level: 1 },
            { type: 'paragraph', text: 'Two hours.' },
            { type: 'button', label: 'Sign up', url: '' },
          ]),
        }}
      />,
    )

    expect(
      within(screen.getByRole('group', { name: 'Button' })).getByText(
        'Add the link this button opens.',
      ),
    ).toBeInTheDocument()
  })

  it('puts a refused send’s error on the block it names', async () => {
    render(
      <Harness
        start={{
          ...written,
          blocks: withIds([
            ...written.blocks.map(({ block }) => block),
            { type: 'button', label: 'Read it', url: 'https://x.example' },
          ]),
        }}
        serverError={{ index: 5, message: 'Links must start with https://.' }}
      />,
    )

    expect(
      within(screen.getByRole('group', { name: 'Button' })).getByText(
        'Links must start with https://.',
      ),
    ).toBeInTheDocument()
  })

  it('previews the blocks as content', async () => {
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
          { type: 'divider' },
        ],
      },
    })
  })
})
