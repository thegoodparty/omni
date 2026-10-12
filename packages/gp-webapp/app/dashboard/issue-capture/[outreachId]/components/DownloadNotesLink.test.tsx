import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import DownloadNotesLink from './DownloadNotesLink'

describe('DownloadNotesLink', () => {
  it('links straight at the export endpoint with the download attribute', () => {
    render(
      <DownloadNotesLink outreachId={41} hasNotes={true} isServe={false} />,
    )

    const link = screen.getByRole('link', { name: 'Download notes' })
    expect(link).toHaveAttribute(
      'href',
      '/api/v1/constituent-feedback/efforts/41/export',
    )
    expect(link).toHaveAttribute('download')
  })

  it('renders nothing when the effort has no notes yet', () => {
    const { container } = render(
      <DownloadNotesLink outreachId={41} hasNotes={false} isServe={false} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  // "Download notes" names no product noun, so it needs no Serve variant —
  // docs/product-vocabulary.md's mode-keyed pattern only forks copy that does.
  it('reads the same on Serve', () => {
    render(<DownloadNotesLink outreachId={41} hasNotes={true} isServe={true} />)

    expect(
      screen.getByRole('link', { name: 'Download notes' }),
    ).toBeInTheDocument()
  })
})
