import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SdkError } from '@/shared/gpApi'

const { hasMock, approveMock, denyMock, editMock } = vi.hoisted(() => ({
  hasMock: vi.fn(),
  approveMock: vi.fn(),
  denyMock: vi.fn(),
  editMock: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ has: hasMock }),
  currentUser: async () => ({
    primaryEmailAddress: { emailAddress: 'cas@goodparty.org' },
    emailAddresses: [],
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/shared/util/gpClient.util', () => ({
  gpAction: (fn: (client: unknown) => unknown) =>
    fn({
      pollOutreachAdmin: {
        approve: approveMock,
        deny: denyMock,
        edit: editMock,
      },
    }),
}))

import { approvePoll, denyPoll, editPollQuestion } from './actions'

beforeEach(() => {
  vi.clearAllMocks()
  hasMock.mockReturnValue(true)
})

describe('poll approval actions', () => {
  it('rejects decisions from a user without org:admin', async () => {
    hasMock.mockReturnValue(false)
    await expect(approvePoll(7)).rejects.toThrow('Only admins')
    await expect(denyPoll(7, 'no')).rejects.toThrow('Only admins')
    await expect(editPollQuestion(7, 'A long enough question')).rejects.toThrow(
      'Only admins'
    )
    expect(approveMock).not.toHaveBeenCalled()
  })

  it('sends the acting admin email with an approval', async () => {
    approveMock.mockResolvedValue({})
    expect(await approvePoll(7)).toEqual({ error: null })
    expect(approveMock).toHaveBeenCalledWith(7, {
      approvedBy: 'cas@goodparty.org',
      expansionId: undefined,
    })
  })

  it('returns the 409 message so a second approver can read it', async () => {
    approveMock.mockRejectedValue(
      new SdkError(409, 'Conflict', undefined, {
        message: 'This poll is not awaiting review any more',
      })
    )
    expect(await approvePoll(7)).toEqual({
      error: 'This poll is not awaiting review any more',
    })
  })

  it('passes the deny reason and the new question through', async () => {
    denyMock.mockResolvedValue({})
    editMock.mockResolvedValue({})
    await denyPoll(7, 'off topic')
    await editPollQuestion(7, 'Should we fund the library?')
    expect(denyMock).toHaveBeenCalledWith(7, {
      deniedBy: 'cas@goodparty.org',
      reason: 'off topic',
    })
    expect(editMock).toHaveBeenCalledWith(7, {
      question: 'Should we fund the library?',
      editedBy: 'cas@goodparty.org',
    })
  })
})
