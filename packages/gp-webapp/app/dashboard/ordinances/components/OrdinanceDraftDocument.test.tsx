import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import type { Ordinance } from '@goodparty_org/contracts'
import OrdinanceDraftDocument from './OrdinanceDraftDocument'

const mocks = vi.hoisted(() => ({
  fetchOrdinanceBySlug: vi.fn(),
  updateOrdinance: vi.fn(),
}))

vi.mock('../data/ordinances-api', () => ({
  fetchOrdinanceBySlug: mocks.fetchOrdinanceBySlug,
  updateOrdinance: mocks.updateOrdinance,
}))

const makeOrdinance = (overrides: Partial<Ordinance>): Ordinance => ({
  id: 'ord-1',
  slug: 'public-safety-cameras',
  electedOfficeId: 'office-1',
  status: 'draft',
  seedType: 'new',
  issueSlug: null,
  sourceLink: null,
  goalText: 'Add camera guardrails',
  existingLaw: null,
  clarify: null,
  clarifyAnswers: null,
  authority: null,
  comparables: null,
  draftTitle: null,
  draftBody: null,
  draftSources: null,
  qualityReport: null,
  research: null,
  scratchpad: null,
  lastViewedStep: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
})

describe('OrdinanceDraftDocument', () => {
  beforeEach(() => {
    mocks.fetchOrdinanceBySlug.mockReset()
    mocks.updateOrdinance.mockReset()
    mocks.updateOrdinance.mockResolvedValue(makeOrdinance({}))
  })

  it('loads and renders the saved draft title and body as editable fields', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(
      makeOrdinance({
        draftTitle: 'Draft amendment to Chapter 12',
        draftBody:
          'Section 12.20  Retention.\n\n(a) Delete footage after 30 days.',
      }),
    )
    render(<OrdinanceDraftDocument slug="public-safety-cameras" />)

    const title = await screen.findByRole('textbox', { name: 'Draft title' })
    expect(title).toHaveValue('Draft amendment to Chapter 12')
    // The title is a textarea, not a single-line input, so a long ordinance
    // title wraps across lines instead of being truncated.
    expect(title.tagName).toBe('TEXTAREA')
    const body = screen.getByRole('textbox', { name: 'Draft body' })
    expect(body).toHaveValue(
      'Section 12.20  Retention.\n\n(a) Delete footage after 30 days.',
    )
  })

  it('shows an empty state when no draft has been generated yet', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(
      makeOrdinance({ draftTitle: null, draftBody: null }),
    )
    render(<OrdinanceDraftDocument slug="public-safety-cameras" />)

    expect(await screen.findByText(/no draft yet/i)).toBeVisible()
    expect(
      screen.queryByRole('textbox', { name: 'Draft body' }),
    ).not.toBeInTheDocument()
  })

  it('autosaves edits to the body via updateOrdinance', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(
      makeOrdinance({
        draftTitle: 'Draft amendment to Chapter 12',
        draftBody: 'Original body.',
      }),
    )
    render(<OrdinanceDraftDocument slug="public-safety-cameras" />)

    const body = await screen.findByRole('textbox', { name: 'Draft body' })
    fireEvent.change(body, { target: { value: 'Edited body text.' } })

    await waitFor(
      () =>
        expect(mocks.updateOrdinance).toHaveBeenCalledWith(
          'public-safety-cameras',
          expect.objectContaining({ draftBody: 'Edited body text.' }),
        ),
      { timeout: 3000 },
    )
  })

  it('renders a redline draft read-only, with struck old text and inserted new text', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(
      makeOrdinance({
        draftTitle: 'Redline of Chapter 18',
        draftBody:
          'Section 18.40  {-Residential rentals generally.-}{+Short-term rental registration.+}',
      }),
    )
    render(<OrdinanceDraftDocument slug="short-term-rentals" />)

    const struck = await screen.findByText('Residential rentals generally.')
    expect(struck).toBeVisible()
    expect(struck).toHaveClass('line-through')
    expect(screen.getByText('Short-term rental registration.')).toBeVisible()
    // A redline is reviewed, not edited inline, so there is no body textbox.
    expect(
      screen.queryByRole('textbox', { name: 'Draft body' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/\{-/)).not.toBeInTheDocument()
  })

  it('shows an error state when the draft cannot be loaded', async () => {
    mocks.fetchOrdinanceBySlug.mockRejectedValue(new Error('boom'))
    render(<OrdinanceDraftDocument slug="public-safety-cameras" />)

    expect(
      await screen.findByText(/couldn't load|could not load/i),
    ).toBeVisible()
  })

  it('links back to the ordinances list', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(
      makeOrdinance({ draftTitle: 'X', draftBody: 'Y' }),
    )
    render(<OrdinanceDraftDocument slug="public-safety-cameras" />)

    const back = await screen.findByRole('link', {
      name: /back to ordinances/i,
    })
    expect(back).toHaveAttribute('href', '/dashboard/ordinances')
  })

  it('autosaves edits to the title', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(
      makeOrdinance({ draftTitle: 'Old title', draftBody: 'Body.' }),
    )
    render(<OrdinanceDraftDocument slug="public-safety-cameras" />)

    const title = await screen.findByRole('textbox', { name: 'Draft title' })
    fireEvent.change(title, { target: { value: 'New title' } })

    await waitFor(
      () =>
        expect(mocks.updateOrdinance).toHaveBeenCalledWith(
          'public-safety-cameras',
          expect.objectContaining({ draftTitle: 'New title' }),
        ),
      { timeout: 3000 },
    )
  })

  it('coalesces rapid edits into a single save', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(
      makeOrdinance({ draftTitle: 'T', draftBody: 'Body.' }),
    )
    render(<OrdinanceDraftDocument slug="public-safety-cameras" />)

    const bodyBox = await screen.findByRole('textbox', { name: 'Draft body' })
    fireEvent.change(bodyBox, { target: { value: 'v1' } })
    fireEvent.change(bodyBox, { target: { value: 'v2' } })
    fireEvent.change(bodyBox, { target: { value: 'v3' } })

    await waitFor(() => expect(mocks.updateOrdinance).toHaveBeenCalled(), {
      timeout: 3000,
    })
    expect(mocks.updateOrdinance).toHaveBeenCalledTimes(1)
    expect(mocks.updateOrdinance).toHaveBeenCalledWith(
      'public-safety-cameras',
      expect.objectContaining({ draftBody: 'v3' }),
    )
  })

  it('reflects save status: unsaved while typing, then saved', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(
      makeOrdinance({ draftTitle: 'T', draftBody: 'Body.' }),
    )
    render(<OrdinanceDraftDocument slug="public-safety-cameras" />)

    const bodyBox = await screen.findByRole('textbox', { name: 'Draft body' })
    fireEvent.change(bodyBox, { target: { value: 'edited' } })
    expect(screen.getByText('Unsaved changes…')).toBeVisible()
    expect(
      await screen.findByText('Saved', {}, { timeout: 3000 }),
    ).toBeVisible()
  })

  it('surfaces a failed save with a retry that re-persists', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(
      makeOrdinance({ draftTitle: 'T', draftBody: 'Body.' }),
    )
    mocks.updateOrdinance.mockRejectedValueOnce(new Error('network'))
    render(<OrdinanceDraftDocument slug="public-safety-cameras" />)

    const bodyBox = await screen.findByRole('textbox', { name: 'Draft body' })
    fireEvent.change(bodyBox, { target: { value: 'edited' } })

    const retry = await screen.findByRole(
      'button',
      { name: /retry/i },
      { timeout: 3000 },
    )
    expect(screen.getByText('Save failed')).toBeVisible()
    fireEvent.click(retry)

    expect(
      await screen.findByText('Saved', {}, { timeout: 3000 }),
    ).toBeVisible()
    // First (rejected) + retry (resolved).
    expect(mocks.updateOrdinance).toHaveBeenCalledTimes(2)
  })

  it('switches to the read-only redline view when redline markup is typed', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(
      makeOrdinance({ draftTitle: 'T', draftBody: 'Plain body.' }),
    )
    render(<OrdinanceDraftDocument slug="public-safety-cameras" />)

    const bodyBox = await screen.findByRole('textbox', { name: 'Draft body' })
    fireEvent.change(bodyBox, {
      target: { value: 'Section 1 {-old-}{+new+}' },
    })

    // Markup is the source of truth for redline-ness, so the editor flips to
    // the read-only redline view immediately (matching a reload).
    expect(
      screen.queryByRole('textbox', { name: 'Draft body' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('old')).toHaveClass('line-through')
    expect(screen.getByText('new')).toBeVisible()
  })

  it('holds an emptied title as unsaved rather than persisting a blank draft', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(
      makeOrdinance({ draftTitle: 'Has a title', draftBody: 'Body.' }),
    )
    render(<OrdinanceDraftDocument slug="public-safety-cameras" />)

    const title = await screen.findByRole('textbox', { name: 'Draft title' })
    fireEvent.change(title, { target: { value: '' } })

    // An incomplete (blank-title) draft is never sent — no 400, no blank write.
    expect(screen.getByText('Unsaved changes…')).toBeVisible()
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(mocks.updateOrdinance).not.toHaveBeenCalled()
    expect(screen.getByText('Unsaved changes…')).toBeVisible()
  })

  it('resumes autosave on the next keystroke after a save failure', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(
      makeOrdinance({ draftTitle: 'T', draftBody: 'Body.' }),
    )
    mocks.updateOrdinance.mockRejectedValueOnce(new Error('network'))
    render(<OrdinanceDraftDocument slug="public-safety-cameras" />)

    const bodyBox = await screen.findByRole('textbox', { name: 'Draft body' })
    fireEvent.change(bodyBox, { target: { value: 'first edit' } })
    await screen.findByText('Save failed', {}, { timeout: 3000 })

    // Typing again must reschedule a save rather than stay stuck in error.
    fireEvent.change(bodyBox, { target: { value: 'second edit' } })
    await waitFor(
      () =>
        expect(mocks.updateOrdinance).toHaveBeenCalledWith(
          'public-safety-cameras',
          expect.objectContaining({ draftBody: 'second edit' }),
        ),
      { timeout: 3000 },
    )
  })

  it('flushes a pending edit when the user navigates away before the debounce fires', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(
      makeOrdinance({ draftTitle: 'T', draftBody: 'Body.' }),
    )
    const { unmount } = render(
      <OrdinanceDraftDocument slug="public-safety-cameras" />,
    )

    const bodyBox = await screen.findByRole('textbox', { name: 'Draft body' })
    fireEvent.change(bodyBox, { target: { value: 'last-edit-before-leaving' } })
    // Unmount immediately, inside the 500ms debounce window.
    unmount()

    await waitFor(() =>
      expect(mocks.updateOrdinance).toHaveBeenCalledWith(
        'public-safety-cameras',
        expect.objectContaining({ draftBody: 'last-edit-before-leaving' }),
      ),
    )
  })

  it('shows a review-only note and a refine link for a redline draft', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(
      makeOrdinance({
        draftTitle: 'Redline of Chapter 18',
        draftBody: 'Section 18.40  {-old text-}{+new text+}',
      }),
    )
    render(<OrdinanceDraftDocument slug="short-term-rentals" />)

    expect(await screen.findByText(/review only/i)).toBeVisible()
    const refine = screen.getByRole('link', {
      name: /refine with your chief of staff/i,
    })
    expect(refine).toHaveAttribute(
      'href',
      '/dashboard/ordinances/solve/short-term-rentals/draft',
    )
  })

  it('offers a refine-with-chief link on an editable draft', async () => {
    mocks.fetchOrdinanceBySlug.mockResolvedValue(
      makeOrdinance({ draftTitle: 'T', draftBody: 'Plain body.' }),
    )
    render(<OrdinanceDraftDocument slug="public-safety-cameras" />)

    const refine = await screen.findByRole('link', {
      name: /refine with your chief of staff/i,
    })
    expect(refine).toHaveAttribute(
      'href',
      '/dashboard/ordinances/solve/public-safety-cameras/draft',
    )
  })
})
