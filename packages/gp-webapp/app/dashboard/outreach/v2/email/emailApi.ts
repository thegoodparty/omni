import { useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  EmailDraft,
  EmailDraftSave,
  EmailRecipientUploadResponse,
  EmailSender,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'

export const EMAIL_SENDER_QUERY_KEY = ['outreach', 'email', 'sender']

export const useEmailSender = () =>
  useQuery({
    queryKey: EMAIL_SENDER_QUERY_KEY,
    queryFn: async (): Promise<EmailSender> =>
      (await clientRequest('GET /v1/outreach/email/sender', {})).data,
  })

export const useChangeForwardTo = () => {
  const queryClient = useQueryClient()
  return async (forwardToEmail: string): Promise<EmailSender> => {
    const { data } = await clientRequest('PATCH /v1/outreach/email/sender', {
      forwardToEmail,
    })
    queryClient.setQueryData(EMAIL_SENDER_QUERY_KEY, data)
    return data
  }
}

export const saveEmailDraft = async (
  input: EmailDraftSave,
): Promise<EmailDraft> =>
  (await clientRequest('POST /v1/outreach/email', input)).data

export const uploadEmailRecipients = async (
  draftId: number,
  file: File,
): Promise<EmailRecipientUploadResponse> => {
  const body = new FormData()
  body.append('consentConfirmed', 'true')
  body.append('file', file)
  const { data } = await clientRequest(
    'POST /v1/outreach/email/:id/recipients',
    { id: String(draftId) },
    { body },
  )
  return data
}

export const apiErrorMessage = (error: unknown): string => {
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = (error as { data?: { message?: unknown } }).data
    if (typeof data?.message === 'string') return data.message
  }
  return 'Something went wrong. Try again.'
}
