import { useQuery } from '@tanstack/react-query'
import type {
  ContactUploadColumnMapping,
  ListContactUploadsResponse,
  SetContactUploadRowMatch,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'

export const contactUploadsKey = (orgSlug: string | undefined) => [
  'contact-uploads',
  orgSlug,
]

export const contactUploadKey = (
  orgSlug: string | undefined,
  uploadId: string,
) => ['contact-uploads', orgSlug, uploadId]

export const contactUploadRowsKey = (
  orgSlug: string | undefined,
  uploadId: string,
) => ['contact-uploads', orgSlug, uploadId, 'rows']

export const contactSourcesKey = (
  orgSlug: string | undefined,
  personId: string,
) => ['contact-sources', orgSlug, personId]

const POLL_MS = 3000

// Polls while any upload is still matching, so a row flips from Processing
// without a refresh.
export const useContactUploads = (enabled = true) => {
  const orgSlug = useOrganization()?.slug
  return useQuery({
    queryKey: contactUploadsKey(orgSlug),
    queryFn: async (): Promise<ListContactUploadsResponse> =>
      (await clientRequest('GET /v1/contact-uploads', {})).data,
    enabled,
    refetchInterval: (query) =>
      query.state.data?.uploads.some((upload) => upload.status === 'processing')
        ? POLL_MS
        : false,
  })
}

export const useContactUpload = (uploadId: string) => {
  const orgSlug = useOrganization()?.slug
  return useQuery({
    queryKey: contactUploadKey(orgSlug, uploadId),
    queryFn: async () =>
      (await clientRequest('GET /v1/contact-uploads/:id', { id: uploadId }))
        .data,
    refetchInterval: (query) =>
      query.state.data?.status === 'processing' ? POLL_MS : false,
  })
}

export const useContactSources = (personId: string | null, enabled = true) => {
  const orgSlug = useOrganization()?.slug
  return useQuery({
    queryKey: contactSourcesKey(orgSlug, personId ?? ''),
    queryFn: async () =>
      (
        await clientRequest('GET /v1/contacts/:personId/sources', {
          personId: personId!,
        })
      ).data,
    enabled: enabled && Boolean(personId),
  })
}

export const createContactUpload = async ({
  file,
  name,
  columnMapping,
}: {
  file: File
  name: string
  columnMapping: ContactUploadColumnMapping
}) => {
  const { data: presign } = await clientRequest(
    'POST /v1/contact-uploads/presign',
    {
      byteSize: file.size,
      fileName: file.name,
      name,
      consentAffirmed: true,
      columnMapping,
    },
  )
  // Straight to S3: the /api proxy can't carry a body over 4.5 MB.
  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': 'text/csv' },
  })
  if (!put.ok) throw new Error(`s3_upload_failed:${put.status}`)
  return (
    await clientRequest('POST /v1/contact-uploads/:id/uploaded', {
      id: presign.uploadId,
    })
  ).data
}

export const setContactUploadRowMatch = async (
  uploadId: string,
  rowId: string,
  match: SetContactUploadRowMatch,
) =>
  (
    await clientRequest('PUT /v1/contact-uploads/:id/rows/:rowId/match', {
      id: uploadId,
      rowId,
      ...match,
    })
  ).data
