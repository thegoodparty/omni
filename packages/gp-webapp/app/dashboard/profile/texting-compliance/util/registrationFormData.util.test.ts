import { describe, expect, it, vi, beforeEach } from 'vitest'
import { clientFetch } from 'gpApi/clientFetch'
import { apiRoutes } from 'gpApi/routes'
import {
  submitTcrCompliance,
  TcrComplianceSubmitError,
  type RegistrationFormData,
} from './registrationFormData.util'

vi.mock('gpApi/clientFetch', () => ({ clientFetch: vi.fn() }))

const mockClientFetch = vi.mocked(clientFetch)

const formData: RegistrationFormData = {
  electionFilingLink: 'https://example.com/filing',
  campaignCommitteeName: 'Friends of Jane',
  candidateName: 'Jane Smith',
  officeLevel: 'local',
  ein: '12-3456780',
  phone: '4155551234',
  address: { formatted_address: '123 Main St', place_id: 'place-123' },
  website: '',
  email: 'jane@example.com',
}

const submit = () =>
  submitTcrCompliance(
    apiRoutes.campaign.tcrCompliance.createAgentic,
    formData,
    'Fallback copy',
  )

const respondWith = (ok: boolean, data: unknown) =>
  mockClientFetch.mockResolvedValue({
    ok,
    status: ok ? 202 : 400,
    statusText: ok ? 'Accepted' : 'Bad Request',
    data,
  })

// The FilingDetailsStep catch shows error.message only for
// TcrComplianceSubmitError instances, so both the class and the message are
// part of the contract.
const expectSubmitError = async (expectedMessage: string) => {
  const error = await submit().then(
    () => {
      throw new Error('expected submitTcrCompliance to reject')
    },
    (thrown: unknown) => thrown,
  )
  expect(error).toBeInstanceOf(TcrComplianceSubmitError)
  expect((error as TcrComplianceSubmitError).message).toBe(expectedMessage)
}

describe('submitTcrCompliance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the response data on success', async () => {
    respondWith(true, { id: 7 })
    await expect(submit()).resolves.toEqual({ id: 7 })
  })

  it("throws the server's Zod issue messages on a validation 400", async () => {
    // nestjs-zod's ZodValidationException body: the actionable detail is in
    // errors[].message; `message` is the constant 'Validation failed'.
    respondWith(false, {
      statusCode: 400,
      message: 'Validation failed',
      errors: [
        { message: 'Election Filing Link must be from the state', path: [] },
        { message: 'A candidate address is required', path: [] },
      ],
    })
    await expectSubmitError(
      'Election Filing Link must be from the state; ' +
        'A candidate address is required',
    )
  })

  it('throws the body message for non-Zod HTTP errors', async () => {
    respondWith(false, {
      statusCode: 404,
      message: 'User not found for this campaign',
    })
    await expectSubmitError('User not found for this campaign')
  })

  it('falls back to the caller copy when the body carries no detail', async () => {
    // 'Validation failed' alone (no issues array) is not actionable copy.
    respondWith(false, { statusCode: 400, message: 'Validation failed' })
    await expectSubmitError('Fallback copy')
  })

  it('falls back to the caller copy for a non-JSON error body', async () => {
    respondWith(false, '<html>Bad Gateway</html>')
    await expectSubmitError('Fallback copy')
  })
})
