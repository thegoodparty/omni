import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import ImportedInFilter from './ImportedInFilter'
import type { ImportedInOption } from './useImportedInOptions'

const imports = (count: number): ImportedInOption[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `upload-${index + 1}`,
    name: `Import ${index + 1}`,
  }))

const renderFilter = (
  options: ImportedInOption[],
  selected: string[] = [],
  state: { isLoading?: boolean; isError?: boolean } = {},
) => {
  const onChange = vi.fn()
  render(
    <ImportedInFilter
      importedIn={{
        options,
        isLoading: state.isLoading ?? false,
        isError: state.isError ?? false,
        refetch: vi.fn(),
      }}
      selected={selected}
      onChange={onChange}
    />,
  )
  return { onChange }
}

describe('ImportedInFilter', () => {
  it('shows each import by the name the user gave it', () => {
    renderFilter([
      { id: 'upload-1', name: 'Town hall sign-in' },
      { id: 'upload-2', name: 'Newsletter list' },
    ])

    expect(screen.getByText('Imported in')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Town hall sign-in' }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(
      screen.getByRole('button', { name: 'Newsletter list' }),
    ).toBeInTheDocument()
  })

  it('adds a picked import to the ones already picked', async () => {
    const { onChange } = renderFilter(imports(3), ['upload-1'])

    await userEvent.click(screen.getByRole('button', { name: 'Import 2' }))

    expect(onChange).toHaveBeenCalledWith(['upload-1', 'upload-2'])
  })

  it('selects every import with Select all, then offers Clear', async () => {
    const { onChange } = renderFilter(imports(3))

    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))

    expect(onChange).toHaveBeenCalledWith(['upload-1', 'upload-2', 'upload-3'])
  })

  it('offers Clear once every import is picked', async () => {
    const { onChange } = renderFilter(imports(2), ['upload-1', 'upload-2'])

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(onChange).toHaveBeenCalledWith([])
  })

  it('shows eight inline, then View all, and keeps a hidden pick inline', () => {
    renderFilter(imports(12), ['upload-11'])

    expect(screen.getByText('View all 12')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 11' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByRole('button', { name: 'Import 12' })).toBeNull()
  })

  it('keeps an undone import picked under a fallback label, so it can be removed', async () => {
    const { onChange } = renderFilter(imports(1), ['upload-gone', 'upload-1'])

    const undone = screen.getByRole('button', { name: 'Undone import' })
    expect(undone).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(undone)

    expect(onChange).toHaveBeenCalledWith(['upload-1'])
  })

  it('shows skeletons while the imports load, not undone pills', () => {
    renderFilter([], ['upload-1'], { isLoading: true })

    expect(screen.queryByText('Undone import')).toBeNull()
  })

  it('offers a retry when the imports do not load', () => {
    renderFilter([], ['upload-1'], { isError: true })

    expect(screen.getByText(/couldn’t load your imports/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument()
  })
})
