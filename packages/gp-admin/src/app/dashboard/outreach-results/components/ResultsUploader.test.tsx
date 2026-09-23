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
  'Contact Phone Number,Message Text,Send Direction\n' +
  '5551234567,Fix Elm St,INBOUND\n5559876543,STOP,INBOUND\n' +
  '5550000000,Yes please,INBOUND\n'

const setup = () =>
  render(
    <Theme>
      <ResultsUploader
        kind="sms"
        id="42"
        sendLabel="September newsletter text"
      />
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
      kind: 'sms',
      id: '42',
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

  // handleCommit's catch is a branch of its own: it shows the error and
  // deliberately does not refresh or toast, so the operator can retry
  // against the report still on screen.
  it('keeps the report and the retry when the commit fails', async () => {
    mockCommit.mockRejectedValue(new Error('gp-api refused the write'))
    setup()
    const user = await upload(GOOD_CSV)
    await user.click(
      await screen.findByRole('button', { name: /check this file/i })
    )
    await screen.findByText(
      '3 rows, 2 matched a recipient, 1 matched nobody, 1 opt-out'
    )

    await user.click(screen.getByRole('button', { name: /save 3 rows/i }))

    await screen.findByText('gp-api refused the write')
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(mockToast).not.toHaveBeenCalled()
    // Still offered, so a retry does not mean re-picking the file.
    expect(screen.getByRole('button', { name: /save 3 rows/i })).toBeTruthy()
    expect(screen.queryByText('Results saved')).toBeNull()
  })

  // Reads are async and the input stays enabled, so two can overlap. The
  // dangerous outcome is not an error, it is the page showing one file's
  // name while holding another's bytes.
  it('ignores a slow read once a newer file has been picked', async () => {
    setup()
    const user = userEvent.setup()
    const input = screen.getByLabelText('Results CSV')

    let releaseSlow: (text: string) => void = () => {}
    const slow = new File(['placeholder'], 'slow.csv', { type: 'text/csv' })
    Object.defineProperty(slow, 'text', {
      value: () =>
        new Promise<string>((resolve) => {
          releaseSlow = resolve
        }),
    })
    const fast = new File([GOOD_CSV], 'fast.csv', { type: 'text/csv' })

    await user.upload(input, slow)
    await user.upload(input, fast)
    await screen.findByText('fast.csv')

    // The abandoned read lands late with a file that would parse fine.
    releaseSlow(
      'phone_number,message_text,send_direction\n5551111111,From the stale file,INBOUND\n'
    )
    await waitFor(() => {
      expect(screen.queryByText('slow.csv')).toBeNull()
    })
    expect(screen.getByText('fast.csv')).toBeTruthy()
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
