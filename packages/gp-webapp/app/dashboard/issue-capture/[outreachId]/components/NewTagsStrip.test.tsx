import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { IssueTag, UpdateIssueTag } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import NewTagsStrip from './NewTagsStrip'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const tag = (fields: Partial<IssueTag> = {}): IssueTag => ({
  id: 'tag-1',
  name: 'Street flooding',
  status: 'proposed',
  source: 'synthesis',
  declaredTopIssueId: null,
  mergedIntoId: null,
  feedbackCount: 3,
  ...fields,
})

const PROPOSED = [tag(), tag({ id: 'tag-2', name: 'Bike lanes' })]

let statusQueries: (string | undefined)[] = []
let patches: { id: string; body: UpdateIssueTag }[] = []

const mockTags = (tags: IssueTag[]) =>
  api.mock('GET /v1/constituent-feedback/tags', ({ query }) => {
    statusQueries.push(query.status)
    return { status: 200, data: { tags } }
  })

const mockPatch = () =>
  api.mock('PATCH /v1/constituent-feedback/tags/:id', ({ params, body }) => {
    patches.push({ id: params.id, body })
    return {
      status: 200,
      data: tag({
        id: params.id,
        status: body.action === 'accept' ? 'accepted' : 'retired',
      }),
    }
  })

const renderStrip = (isServe = false) =>
  render(<NewTagsStrip isServe={isServe} />)

beforeEach(() => {
  testQueryClient.clear()
  vi.mocked(trackEvent).mockClear()
  statusQueries = []
  patches = []
  mockPatch()
})

describe('NewTagsStrip', () => {
  it('lists the proposed tags', async () => {
    mockTags(PROPOSED)
    renderStrip()

    const strip = await screen.findByRole('region', {
      name: 'New tags to review',
    })
    expect(within(strip).getByText('Street flooding')).toBeInTheDocument()
    expect(within(strip).getByText('Bike lanes')).toBeInTheDocument()
    expect(statusQueries).toEqual(['proposed'])
  })

  it('accepts a tag with an accept action', async () => {
    mockTags(PROPOSED)
    renderStrip(true)

    const row = await screen.findByRole('listitem', { name: 'Street flooding' })
    // The list after the write: the accepted tag is no longer a proposal.
    mockTags([tag({ id: 'tag-2', name: 'Bike lanes' })])
    fireEvent.click(within(row).getByRole('button', { name: 'Accept' }))

    await waitFor(() =>
      expect(patches).toEqual([{ id: 'tag-1', body: { action: 'accept' } }]),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('listitem', { name: 'Street flooding' }),
      ).toBeNull(),
    )
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.IssueCapture.TagAccepted, {
      source: 'report',
      product: 'serve',
    })
  })

  it('dismisses a tag by retiring it', async () => {
    mockTags(PROPOSED)
    renderStrip()

    const row = await screen.findByRole('listitem', { name: 'Bike lanes' })
    fireEvent.click(within(row).getByRole('button', { name: 'Dismiss' }))

    await waitFor(() =>
      expect(patches).toEqual([{ id: 'tag-2', body: { action: 'retire' } }]),
    )
    expect(trackEvent).not.toHaveBeenCalledWith(
      EVENTS.IssueCapture.TagAccepted,
      expect.anything(),
    )
  })

  // A volunteer can read nothing here; the strip is the manager's.
  it('renders nothing when the tag list is refused', async () => {
    api.mock('GET /v1/constituent-feedback/tags', () => {
      statusQueries.push('refused')
      return { status: 403, data: { message: 'Forbidden' } }
    })
    const { container } = renderStrip()

    await waitFor(() => expect(statusQueries).toEqual(['refused']))
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when there is nothing to review', async () => {
    mockTags([])
    const { container } = renderStrip()

    await waitFor(() => expect(statusQueries).toEqual(['proposed']))
    expect(container).toBeEmptyDOMElement()
  })
})
