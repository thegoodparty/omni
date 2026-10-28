import { useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  EmailDraft,
  EmailDraftSave,
  EmailRecipientUploadResponse,
  EmailSender,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'

export const emailSenderQueryKey = (serve: boolean) => [
  'outreach',
  serve ? 'serve-email' : 'email',
  'sender',
]

export const useEmailSender = (serve: boolean) =>
  useQuery({
    queryKey: emailSenderQueryKey(serve),
    queryFn: async (): Promise<EmailSender> =>
      (
        await (serve
          ? clientRequest('GET /v1/outreach/serve/email/sender', {})
          : clientRequest('GET /v1/outreach/email/sender', {}))
      ).data,
  })

export const useChangeForwardTo = (serve: boolean) => {
  const queryClient = useQueryClient()
  return async (forwardToEmail: string): Promise<EmailSender> => {
    const { data } = await (serve
      ? clientRequest('PATCH /v1/outreach/serve/email/sender', {
          forwardToEmail,
        })
      : clientRequest('PATCH /v1/outreach/email/sender', { forwardToEmail }))
    queryClient.setQueryData(emailSenderQueryKey(serve), data)
    return data
  }
}

export const saveEmailDraft = async (
  serve: boolean,
  input: EmailDraftSave,
): Promise<EmailDraft> =>
  (
    await (serve
      ? clientRequest('POST /v1/outreach/serve/email', input)
      : clientRequest('POST /v1/outreach/email', input))
  ).data

export const uploadEmailRecipients = async (
  serve: boolean,
  draftId: number,
  file: File,
): Promise<EmailRecipientUploadResponse> => {
  const body = new FormData()
  body.append('consentConfirmed', 'true')
  body.append('file', file)
  const id = { id: String(draftId) }
  const { data } = await (serve
    ? clientRequest('POST /v1/outreach/serve/email/:id/recipients', id, {
        body,
      })
    : clientRequest('POST /v1/outreach/email/:id/recipients', id, { body }))
  return data
}

export const apiErrorMessage = (error: unknown): string => {
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = (error as { data?: { message?: unknown } }).data
    if (typeof data?.message === 'string') return data.message
    if (Array.isArray(data?.message)) {
      const first: unknown = data.message[0]
      if (typeof first === 'string') return first
    }
  }
  return 'Something went wrong. Try again.'
}
