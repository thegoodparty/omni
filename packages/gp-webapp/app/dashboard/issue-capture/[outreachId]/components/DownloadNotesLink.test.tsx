import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import DownloadNotesLink from './DownloadNotesLink'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

describe('DownloadNotesLink', () => {
  it('links straight at the export endpoint with the download attribute', () => {
    render(
      <DownloadNotesLink
        outreachId={41}
        hasNotes={true}
        channel="door_knock"
        isServe={false}
      />,
    )

    const link = screen.getByRole('link', { name: 'Download' })
    expect(link).toHaveAttribute(
      'href',
      '/api/v1/constituent-feedback/efforts/41/export',
    )
    expect(link).toHaveAttribute('download')
  })

  it('renders nothing when the effort has no notes yet', () => {
    const { container } = render(
      <DownloadNotesLink
        outreachId={41}
        hasNotes={false}
        channel="door_knock"
        isServe={false}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('records the download with its channel and product', () => {
    render(
      <DownloadNotesLink
        outreachId={41}
        hasNotes={true}
        channel="phone_bank"
        isServe={true}
      />,
    )

    const link = screen.getByRole('link', { name: 'Download' })
    // jsdom cannot follow a link; React's handler still runs.
    link.addEventListener('click', (event) => event.preventDefault())
    fireEvent.click(link)

    expect(trackEvent).toHaveBeenCalledWith(
      EVENTS.IssueCapture.NotesDownloaded,
      { channel: 'phoneBanking', product: 'serve' },
    )
  })

  // "Download" names no product noun, so it needs no Serve variant —
  // docs/product-vocabulary.md's mode-keyed pattern only forks copy that does.
  it('reads the same on Serve', () => {
    render(
      <DownloadNotesLink
        outreachId={41}
        hasNotes={true}
        channel="door_knock"
        isServe={true}
      />,
    )

    expect(screen.getByRole('link', { name: 'Download' })).toBeInTheDocument()
  })
})
