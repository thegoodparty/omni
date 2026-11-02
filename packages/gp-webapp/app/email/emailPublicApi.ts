import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  EmailForwardConfirmState,
  EmailUnsubscribeState,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'

export const useUnsubscribeState = (token: string) =>
  useQuery({
    queryKey: ['email', 'unsubscribe', token],
    queryFn: async (): Promise<EmailUnsubscribeState> =>
      (await clientRequest('GET /v1/email/unsubscribe', { t: token })).data,
    retry: false,
    refetchOnWindowFocus: false,
  })

export const useUnsubscribeAction = (
  token: string,
  action: 'unsubscribe' | 'undo',
) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<EmailUnsubscribeState> =>
      (
        await (action === 'undo'
          ? clientRequest('POST /v1/email/unsubscribe/undo', { token })
          : clientRequest('POST /v1/email/unsubscribe', { token }))
      ).data,
    onSuccess: (state) =>
      queryClient.setQueryData(['email', 'unsubscribe', token], state),
  })
}

export const useForwardConfirmState = (token: string) =>
  useQuery({
    queryKey: ['email', 'forward-confirm', token],
    queryFn: async (): Promise<EmailForwardConfirmState> =>
      (await clientRequest('GET /v1/email/forward-confirm/:token', { token }))
        .data,
    retry: false,
    refetchOnWindowFocus: false,
  })

export const useConfirmForward = (token: string) =>
  useMutation({
    mutationFn: async (): Promise<EmailForwardConfirmState> =>
      (await clientRequest('POST /v1/email/forward-confirm', { token })).data,
  })
