import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  EmailAudienceCountsRequest,
  EmailAiDraftRequest,
  EmailConfirmResponse,
  EmailSend,
  EmailAiDraftResponse,
  EmailDraft,
  EmailDraftSave,
  EmailImagePresignRequest,
  EmailPreviewRequest,
  EmailSender,
  EmailTestSendResponse,
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

const audienceCountsQuery = (
  serve: boolean,
  input: EmailAudienceCountsRequest,
  enabled: boolean,
) => ({
  queryKey: [
    'outreach',
    serve ? 'serve-email' : 'email',
    'audience-counts',
    input,
  ],
  queryFn: async () =>
    (
      await (serve
        ? clientRequest('POST /v1/outreach/serve/email/audience-counts', input)
        : clientRequest('POST /v1/outreach/email/audience-counts', input))
    ).data,
  enabled,
  staleTime: 0,
  refetchOnWindowFocus: false,
})

// Who has an email address: everyone, or each import and saved list in the
// picker, in one request. Read afresh each time the step asks, so contacts
// imported meanwhile count.
export const useEmailAudienceCounts = (
  serve: boolean,
  input: EmailAudienceCountsRequest,
  enabled: boolean,
) => useQuery(audienceCountsQuery(serve, input, enabled))

// The picker shows about six rows at a time, so the first ones counted are
// the ones on screen: a small first request, on its own so it comes back
// fast, then the rest in requests the size of one gp-api warehouse statement.
// Each request's counts show as soon as it answers.
const FIRST_LIST_COUNTS = 10
const LIST_COUNTS_PER_REQUEST = 25

export const listCountBatches = <T>(ids: T[]): T[][] => {
  const batches = [ids.slice(0, FIRST_LIST_COUNTS)]
  for (
    let start = FIRST_LIST_COUNTS;
    start < ids.length;
    start += LIST_COUNTS_PER_REQUEST
  ) {
    batches.push(ids.slice(start, start + LIST_COUNTS_PER_REQUEST))
  }
  return batches.filter((batch) => batch.length > 0)
}

type CountedRow = { uploadId: string } | { listId: number }

const countsRequest = (batch: CountedRow[]): EmailAudienceCountsRequest => {
  const uploadIds = batch.flatMap((row) =>
    'uploadId' in row ? [row.uploadId] : [],
  )
  return {
    everyone: false,
    listIds: batch.flatMap((row) => ('listId' in row ? [row.listId] : [])),
    ...(uploadIds.length > 0 ? { uploadIds } : {}),
  }
}

// Each import's and list's email count, in the picker's order: the imports,
// then the lists. The later requests wait for the first to answer (or fail).
export const useEmailListCounts = (
  serve: boolean,
  ids: { uploadIds: string[]; listIds: number[] },
  enabled: boolean,
): {
  lists: Map<number, number | null>
  uploads: Map<string, number | null>
} => {
  const [first = [], ...rest] = listCountBatches<CountedRow>([
    ...ids.uploadIds.map((uploadId) => ({ uploadId })),
    ...ids.listIds.map((listId) => ({ listId })),
  ])
  const firstQuery = useEmailAudienceCounts(
    serve,
    countsRequest(first),
    enabled && first.length > 0,
  )
  const restQueries = useQueries({
    queries: rest.map((batch) =>
      audienceCountsQuery(
        serve,
        countsRequest(batch),
        enabled && !firstQuery.isPending,
      ),
    ),
  })
  const answers = [firstQuery, ...restQueries]
  return {
    lists: new Map(
      answers.flatMap(({ data }) =>
        (data?.lists ?? []).map((list) => [list.id, list.count] as const),
      ),
    ),
    uploads: new Map(
      answers.flatMap(({ data }) =>
        (data?.uploads ?? []).map(
          (upload) => [upload.id, upload.count] as const,
        ),
      ),
    ),
  }
}

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

export const draftEmailWithAi = async (
  serve: boolean,
  input: EmailAiDraftRequest,
): Promise<EmailAiDraftResponse> =>
  (
    await (serve
      ? clientRequest('POST /v1/outreach/serve/email/draft', input)
      : clientRequest('POST /v1/outreach/email/draft', input))
  ).data

export const previewEmail = async (
  serve: boolean,
  input: EmailPreviewRequest,
): Promise<string> =>
  (
    await (serve
      ? clientRequest('POST /v1/outreach/serve/email/preview', input)
      : clientRequest('POST /v1/outreach/email/preview', input))
  ).data.html

// The saved imageUrl must be the publicUrl gp-api presigned, so the file goes
// straight to S3 with the returned form fields and the URL comes from here.
export const uploadEmailImage = async (
  serve: boolean,
  file: File,
  contentType: EmailImagePresignRequest['contentType'],
): Promise<string> => {
  const { data: presign } = await (serve
    ? clientRequest('POST /v1/outreach/serve/email/images/presign', {
        contentType,
      })
    : clientRequest('POST /v1/outreach/email/images/presign', { contentType }))
  const body = new FormData()
  Object.entries(presign.fields).forEach(([key, value]) =>
    body.append(key, value),
  )
  body.append('file', file)
  const response = await fetch(presign.url, { method: 'POST', body })
  if (!response.ok) throw new Error('Image upload failed')
  return presign.publicUrl
}

export const sendEmailTest = async (
  serve: boolean,
  draftId: number,
): Promise<EmailTestSendResponse> => {
  const id = { id: String(draftId) }
  const { data } = await (serve
    ? clientRequest('POST /v1/outreach/serve/email/:id/test', id)
    : clientRequest('POST /v1/outreach/email/:id/test', id))
  return data
}

export const emailSendQueryKey = (serve: boolean, id: number) => [
  'outreach',
  serve ? 'serve-email' : 'email',
  'send',
  id,
]

// A send that is still moving is re-read every 15 seconds.
const ACTIVE_STATUSES = ['pending', 'in_progress']

export const useEmailSend = (serve: boolean, id: number | null) =>
  useQuery({
    queryKey: emailSendQueryKey(serve, id ?? 0),
    enabled: id !== null,
    queryFn: async (): Promise<EmailSend> => {
      const params = { id: String(id) }
      return (
        await (serve
          ? clientRequest('GET /v1/outreach/serve/email/:id', params)
          : clientRequest('GET /v1/outreach/email/:id', params))
      ).data
    },
    refetchInterval: (query) =>
      ACTIVE_STATUSES.includes(query.state.data?.status ?? '') ? 15_000 : false,
  })

export const confirmEmail = async (
  serve: boolean,
  id: number,
  paymentMethodId: string,
): Promise<EmailConfirmResponse> => {
  const input = { id: String(id), paymentMethodId }
  const { data } = await (serve
    ? clientRequest('POST /v1/outreach/serve/email/:id/confirm', input)
    : clientRequest('POST /v1/outreach/email/:id/confirm', input))
  return data
}

export const cancelEmail = async (
  serve: boolean,
  id: number,
): Promise<EmailSend> => {
  const params = { id: String(id) }
  const { data } = await (serve
    ? clientRequest('POST /v1/outreach/serve/email/:id/cancel', params)
    : clientRequest('POST /v1/outreach/email/:id/cancel', params))
  return data
}

// A pending_payment send's confirm answers from the stored hold and never
// reads the card id. A new card goes to the hold's own route, so a confirm
// after it only moves the send out of pending_payment.
export const CARD_ON_FILE = 'card-on-file'

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
