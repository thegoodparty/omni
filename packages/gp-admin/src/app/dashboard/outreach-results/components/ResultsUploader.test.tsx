import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import { ResultsUploader } from './ResultsUploader'

const { mockDryRun, mockCommit, mockRefresh, mockToast } = vi.hoisted(() => ({
  mockDryRun: vi.fn(),
  mockCommit: vi.fn(),
  mockRefresh: vi.fn(),
  mockToast: vi.fn(),
}))

vi.mock('../actions', () => ({
  dryRunResultsUpload: mockDryRun,
  commitResultsUpload: mockCommit,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast: mockToast }),
}))

// jsdom's File does not implement Blob.text(), which every target browser
// has. Fill it in rather than reshape the component around the gap.
if (typeof File.prototype.text !== 'function') {
  Object.defineProperty(File.prototype, 'text', {
    configurable: true,
    value(this: File) {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error)
        reader.readAsText(this)
      })
    },
  })
}

beforeEach(() => {
  mockDryRun.mockReset()
  mockCommit.mockReset()
  mockRefresh.mockReset()
  mockToast.mockReset()
  mockDryRun.mockResolvedValue({
    rowsParsed: 3,
    matched: 2,
    unmatched: 1,
    optOuts: 1,
    committed: false,
  })
  mockCommit.mockResolvedValue({
    rowsParsed: 3,
    matched: 2,
    unmatched: 1,
    optOuts: 1,
    committed: true,
  })
})

const GOOD_CSV =
  'Contact Phone Number,Message Text\n5551234567,Fix Elm St\n5559876543,STOP\n5550000000,Yes please\n'

const setup = () =>
  render(
    <Theme>
      <ResultsUploader outreachId={42} sendLabel="September newsletter text" />
    </Theme>
  )

const upload = async (contents: string, name = 'results.csv') => {
  const user = userEvent.setup()
  const input = screen.getByLabelText('Results CSV')
  await user.upload(input, new File([contents], name, { type: 'text/csv' }))
  return user
}

describe('ResultsUploader', () => {
  it('reports before it can commit: no server call on file selection', async () => {
    setup()
    await upload(GOOD_CSV)

    await screen.findByText(/3 of 3/)
    expect(mockDryRun).not.toHaveBeenCalled()
    expect(mockCommit).not.toHaveBeenCalled()
    // The commit button does not exist until a report has been shown.
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
  })

  it('shows the report, and only then offers the commit', async () => {
    setup()
    const user = await upload(GOOD_CSV)

    await user.click(
      await screen.findByRole('button', { name: /check this file/i })
    )

    await screen.findByText(
      '3 rows, 2 matched a recipient, 1 matched nobody, 1 opt-out'
    )
    expect(mockDryRun).toHaveBeenCalledWith({
      outreachId: 42,
      fileName: 'results.csv',
      csv: GOOD_CSV,
    })
    expect(mockCommit).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /save 3 rows/i }))
    await waitFor(() => expect(mockCommit).toHaveBeenCalledTimes(1))
    expect(mockRefresh).toHaveBeenCalled()
    await screen.findByText('Results saved')
  })

  it('calls nobody when the file has the wrong columns', async () => {
    setup()
    await upload('name,note\nAva,Hi\n', 'wrong.csv')

    await screen.findByText(/Missing required column/)
    expect(mockDryRun).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('button', { name: /check this file/i })
    ).toBeNull()
  })

  it('warns about rows that matched nobody instead of burying the number', async () => {
    setup()
    const user = await upload(GOOD_CSV)
    await user.click(
      await screen.findByRole('button', { name: /check this file/i })
    )
    await screen.findByText(/came from a number that was not on this send/)
  })
})
