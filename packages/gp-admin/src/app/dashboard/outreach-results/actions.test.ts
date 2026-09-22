import { describe, it, expect, vi, beforeEach } from 'vitest'

// A server action is a POST endpoint, so these tests call it the way a
// script would — without the page having run any of its own checks first.

const { mockAuth, mockCurrentUser, mockUpload, mockRevalidate } = vi.hoisted(
  () => ({
    mockAuth: vi.fn(),
    mockCurrentUser: vi.fn(),
    mockUpload: vi.fn(),
    mockRevalidate: vi.fn(),
  })
)

vi.mock('@clerk/nextjs/server', () => ({
  auth: mockAuth,
  currentUser: mockCurrentUser,
}))
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidate }))
vi.mock('./gateway', () => ({
  getOutreachResultsGateway: () => ({
    listAwaiting: vi.fn(),
    getTarget: vi.fn(),
    upload: mockUpload,
  }),
  isEndpointsUnavailable: () => false,
}))

import { commitResultsUpload, dryRunResultsUpload } from './actions'

const WHOLE =
  'phone_number,message_text,send_direction\n' +
  '5551234567,"Fix Elm St",INBOUND\n5559876543,"Yes",INBOUND\n'
// Cut inside the last quoted value, which is the shape the rule is about —
// an offset from the end stops landing there as soon as a column is added.
const TRUNCATED = WHOLE.slice(0, WHOLE.lastIndexOf('"Yes"') + 3)

beforeEach(() => {
  mockUpload.mockReset()
  mockRevalidate.mockReset()
  mockAuth.mockResolvedValue({ has: () => true })
  mockCurrentUser.mockResolvedValue({
    primaryEmailAddress: { emailAddress: 'staff@goodparty.org' },
    emailAddresses: [],
  })
  mockUpload.mockResolvedValue({
    rowsParsed: 2,
    matched: 2,
    unmatched: 0,
    optOuts: 0,
    committed: true,
  })
})

describe('results upload actions', () => {
  it('refuses a truncated file on commit, without calling gp-api', async () => {
    await expect(
      commitResultsUpload({
        outreachId: 42,
        fileName: 'results.csv',
        csv: TRUNCATED,
      })
    ).rejects.toThrow(/incomplete/i)
    expect(mockUpload).not.toHaveBeenCalled()
    expect(mockRevalidate).not.toHaveBeenCalled()
  })

  it('refuses a truncated file on the dry run too', async () => {
    mockUpload.mockResolvedValue({
      rowsParsed: 2,
      matched: 2,
      unmatched: 0,
      optOuts: 0,
      committed: false,
    })
    await expect(
      dryRunResultsUpload({
        outreachId: 42,
        fileName: 'results.csv',
        csv: TRUNCATED,
      })
    ).rejects.toThrow(/incomplete/i)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('refuses a file with the wrong columns', async () => {
    await expect(
      commitResultsUpload({
        outreachId: 42,
        fileName: 'results.csv',
        csv: 'name,note\nAva,Hi\n',
      })
    ).rejects.toThrow(/Missing required column/)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('lets a whole file through and stamps who uploaded it', async () => {
    await commitResultsUpload({
      outreachId: 42,
      fileName: 'results.csv',
      csv: WHOLE,
    })
    expect(mockUpload).toHaveBeenCalledWith(42, {
      fileName: 'results.csv',
      csv: WHOLE,
      dryRun: false,
      sourceLabel: 'gp-admin upload by staff@goodparty.org',
    })
    expect(mockRevalidate).toHaveBeenCalledWith(
      '/dashboard/outreach-results/42'
    )
  })

  it('refuses anyone who is not an org admin, before looking at the file', async () => {
    mockAuth.mockResolvedValue({ has: () => false })
    await expect(
      commitResultsUpload({
        outreachId: 42,
        fileName: 'results.csv',
        csv: WHOLE,
      })
    ).rejects.toThrow(/admin/i)
    expect(mockUpload).not.toHaveBeenCalled()
  })
})
