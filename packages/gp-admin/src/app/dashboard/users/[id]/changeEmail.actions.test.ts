import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SdkError } from '@/shared/gpApi'
import { PERMISSIONS } from '@/lib/permissions'
import { changeUserEmail } from './changeEmail.actions'

const USER_ID = 348
const NEW_EMAIL = 'new@example.com'

const mockHas = vi.fn()
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => ({ userId: 'user_admin_123', has: mockHas }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const mockChangeEmail = vi.fn()
vi.mock('@/shared/util/gpClient.util', () => ({
  gpAction: vi.fn(async (fn: (client: unknown) => unknown) =>
    fn({ users: { changeEmail: mockChangeEmail } })
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockHas.mockReturnValue(true)
})

describe('changeUserEmail', () => {
  it('returns the changed user and the HubSpot outcome', async () => {
    const output = {
      user: { id: USER_ID, email: NEW_EMAIL },
      crm: { status: 'updated', contactId: '1' },
    }
    mockChangeEmail.mockResolvedValue(output)

    expect(await changeUserEmail(USER_ID, NEW_EMAIL)).toEqual({
      data: output,
      error: null,
    })
    expect(mockChangeEmail).toHaveBeenCalledWith(USER_ID, { email: NEW_EMAIL })
  })

  it('needs write_users', async () => {
    mockHas.mockReturnValue(false)

    const result = await changeUserEmail(USER_ID, NEW_EMAIL)

    expect(result.error).toMatch(/write_users/)
    expect(mockHas).toHaveBeenCalledWith({
      permission: PERMISSIONS.WRITE_USERS,
    })
    expect(mockChangeEmail).not.toHaveBeenCalled()
  })

  it("returns gp-api's message when the email is taken", async () => {
    mockChangeEmail.mockRejectedValue(
      new SdkError(409, 'Conflict', undefined, {
        message: 'Email belongs to user 99',
      })
    )

    const result = await changeUserEmail(USER_ID, NEW_EMAIL)

    expect(result).toEqual({ data: null, error: 'Email belongs to user 99' })
  })
})
