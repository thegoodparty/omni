import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type { ContrastRecord } from 'gpApi/api-endpoints'
import ContrastList from './ContrastList'

vi.mock('@shared/sentry', () => ({
  reportErrorToSentry: vi.fn(),
}))

const baseContrast = (
  overrides: Partial<ContrastRecord> = {},
): ContrastRecord => ({
  id: 1,
  opponentFact: 'voted against the housing bill',
  sourceUrl: 'https://ballotpedia.org/finding',
  candidateFact: 'support more housing',
  contrastSentence:
    'On Housing, my opponent voted against the bill — I support more housing.',
  issueTag: 'Housing',
  routing: 'story',
  status: 'cleared',
  editCount: 0,
  findingId: 10,
  routedStoryId: null,
  routedOutreachId: null,
  createdAt: '2026-06-20T12:00:00.000Z',
  updatedAt: '2026-06-20T12:00:00.000Z',
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('<ContrastList>', () => {
  it('renders a complete contrast with its source link', () => {
    render(<ContrastList initialContrasts={[baseContrast()]} />)

    expect(
      screen.getByText(
        'On Housing, my opponent voted against the bill — I support more housing.',
      ),
    ).toBeInTheDocument()
    const source = screen.getByRole('link', { name: /source/i })
    expect(source).toHaveAttribute('href', 'https://ballotpedia.org/finding')
  })

  it('never renders a contrast missing its sourceUrl', () => {
    const noSource = baseContrast({ id: 2, sourceUrl: '' })

    const { container } = render(<ContrastList initialContrasts={[noSource]} />)

    expect(
      screen.queryByText(noSource.contrastSentence),
    ).not.toBeInTheDocument()
    // Hidden, not placeholdered: no "coming soon" copy, nothing in the DOM.
    expect(
      screen.queryByText(/No contrasts to review yet/i),
    ).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('never renders a contrast missing any of the six content fields', () => {
    const missingFields: ContrastRecord[] = [
      baseContrast({ id: 3, opponentFact: '' }),
      baseContrast({ id: 4, candidateFact: '' }),
      baseContrast({ id: 5, contrastSentence: '' }),
      baseContrast({ id: 6, issueTag: '' }),
      baseContrast({ id: 7, sourceUrl: '   ' }),
      baseContrast({ id: 8, routing: '' as ContrastRecord['routing'] }),
    ]

    const { container } = render(
      <ContrastList initialContrasts={missingFields} />,
    )

    expect(
      screen.queryByText(/No contrasts to review yet/i),
    ).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing (no placeholder shell) when the list is empty', () => {
    const { container } = render(<ContrastList initialContrasts={[]} />)

    expect(
      screen.queryByText(/No contrasts to review yet/i),
    ).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('shows only the renderable contrast among a mixed list', () => {
    const good = baseContrast({ id: 8 })
    const bad = baseContrast({ id: 9, sourceUrl: '' })

    render(<ContrastList initialContrasts={[good, bad]} />)

    expect(screen.getByText(good.contrastSentence)).toBeInTheDocument()
    // Only one contrast card renders — the one with a source.
    expect(screen.getAllByRole('link', { name: /source/i })).toHaveLength(1)
  })

  it('always shows the no-auto-send disclosure on a card', () => {
    render(<ContrastList initialContrasts={[baseContrast()]} />)

    expect(screen.getByText(/No auto-send/i)).toBeInTheDocument()
    expect(screen.getByText(/draft only/i)).toBeInTheDocument()
  })

  it('edits a contrast: calls the edit route and reflects the new text', async () => {
    const user = userEvent.setup()
    const contrast = baseContrast()
    const newSentence =
      'On Housing, my opponent blocked the bill — I will build more homes.'

    api.mock('PATCH /v1/campaigns/mine/race-opponent/contrasts/:id', {
      status: 200,
      data: {
        contrast: {
          ...contrast,
          contrastSentence: newSentence,
          candidateFact: 'will build more homes',
          editCount: 1,
        },
      },
    })

    render(<ContrastList initialContrasts={[contrast]} />)

    await user.click(screen.getByRole('button', { name: /^edit$/i }))

    const sentenceBox = screen.getByPlaceholderText('The contrast sentence')
    await user.clear(sentenceBox)
    await user.type(sentenceBox, newSentence)

    const factBox = screen.getByPlaceholderText('Your fact')
    await user.clear(factBox)
    await user.type(factBox, 'will build more homes')

    await user.click(screen.getByRole('button', { name: /save edit/i }))

    await waitFor(() => {
      expect(screen.getByText(newSentence)).toBeInTheDocument()
    })
    // Back in read mode, old text gone.
    expect(
      screen.queryByText(contrast.contrastSentence),
    ).not.toBeInTheDocument()
  })

  it('routes a contrast to Story: reflects used/draft state and hides actions', async () => {
    const user = userEvent.setup()
    const contrast = baseContrast()

    api.mock('POST /v1/campaigns/mine/race-opponent/contrasts/:id/route', {
      status: 200,
      data: {
        contrast: { ...contrast, status: 'used', routedStoryId: 99 },
        routedStoryId: 99,
      },
    })

    render(<ContrastList initialContrasts={[contrast]} />)

    await user.click(screen.getByRole('button', { name: /route to story/i }))

    await waitFor(() => {
      expect(screen.getByText(/Routed as draft/i)).toBeInTheDocument()
    })
    // Once used, the route/edit actions are disabled (no further sending).
    expect(
      screen.getByRole('button', { name: /route to story/i }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /route to texting/i }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeDisabled()
  })

  it('routes a contrast to Texting and marks it a routed draft', async () => {
    const user = userEvent.setup()
    const contrast = baseContrast()

    api.mock('POST /v1/campaigns/mine/race-opponent/contrasts/:id/route', {
      status: 200,
      data: {
        contrast: { ...contrast, status: 'used', routedOutreachId: 42 },
        routedOutreachId: 42,
      },
    })

    render(<ContrastList initialContrasts={[contrast]} />)

    await user.click(screen.getByRole('button', { name: /route to texting/i }))

    await waitFor(() => {
      expect(screen.getByText(/Routed as draft/i)).toBeInTheDocument()
    })
  })
})
