/**
 * Client-side attachment API for the chat attachments feature.
 * Encapsulates the upload (presign → S3 presigned POST → finalize),
 * link-paste, list, and delete flows.
 */

import { clientRequest } from 'gpApi/typed-request'

export type AttachmentStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface ChatAttachmentState {
  id: string
  fileName: string
  status: AttachmentStatus
  pageCount: number | null
  failureReason: string | null
}

// Resolve MIME type from file — same pattern as briefings/attachments-api.ts
const EXTENSION_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

export const resolveMimeType = (file: File): string => {
  if (file.type) return file.type
  const dot = file.name.lastIndexOf('.')
  if (dot < 0) return ''
  const ext = file.name.slice(dot + 1).toLowerCase()
  return EXTENSION_MIME[ext] ?? ''
}

/**
 * Upload a file: presign → S3 presigned POST → finalize.
 * Returns the server-created attachment state.
 */
export const uploadChatAttachment = async (
  conversationId: string,
  file: File,
): Promise<ChatAttachmentState> => {
  const mimeType = resolveMimeType(file)

  const { data: presign } = await clientRequest(
    'POST /v1/chats/:conversationId/attachments/presign',
    {
      conversationId,
      fileName: file.name,
      mimeType,
      sizeBytes: file.size,
    },
  )

  // Presigned POST to S3 — fields must come before the file
  const form = new FormData()
  for (const [key, value] of Object.entries(presign.uploadFields)) {
    form.append(key, value)
  }
  form.append('file', file)
  const s3Res = await fetch(presign.uploadUrl, { method: 'POST', body: form })
  if (!s3Res.ok) {
    throw new Error(`s3_upload_failed:${s3Res.status}`)
  }

  const { data: attachment } = await clientRequest(
    'POST /v1/chats/:conversationId/attachments',
    { conversationId, storageKey: presign.storageKey },
  )

  return {
    id: attachment.id,
    fileName: attachment.fileName,
    status: attachment.status,
    pageCount: attachment.pageCount ?? null,
    failureReason: attachment.failureReason ?? null,
  }
}

/**
 * Paste a URL as an attachment.
 * Returns the attachment on success, or an error string on failure.
 */
export const linkChatAttachment = async (
  conversationId: string,
  url: string,
): Promise<
  { ok: true; attachment: ChatAttachmentState } | { ok: false; error: string }
> => {
  const { data } = await clientRequest(
    'POST /v1/chats/:conversationId/attachments/link',
    { conversationId, url },
  )
  if (!data.ok) {
    return { ok: false, error: data.error }
  }
  return {
    ok: true,
    attachment: {
      id: data.attachment.id,
      fileName: data.attachment.fileName,
      status: data.attachment.status,
      pageCount: data.attachment.pageCount ?? null,
      failureReason: data.attachment.failureReason ?? null,
    },
  }
}

/**
 * Poll the attachment list for status updates on pending/processing items.
 * Returns the full list.
 */
export const listChatAttachments = async (
  conversationId: string,
): Promise<ChatAttachmentState[]> => {
  const { data } = await clientRequest(
    'GET /v1/chats/:conversationId/attachments',
    { conversationId },
  )
  return data.attachments.map((a) => ({
    id: a.id,
    fileName: a.fileName,
    status: a.status,
    pageCount: a.pageCount ?? null,
    failureReason: a.failureReason ?? null,
  }))
}

/**
 * Delete an attachment before send.
 */
export const deleteChatAttachment = async (
  conversationId: string,
  attachmentId: string,
): Promise<void> => {
  await clientRequest(
    'DELETE /v1/chats/:conversationId/attachments/:attachmentId',
    {
      conversationId,
      attachmentId,
    },
  )
}

/** Human-readable label for a link error code. */
export const linkErrorMessage = (error: string): string => {
  switch (error) {
    case 'unreachable':
      return "Couldn't reach that URL. Check the link and try again."
    case 'blocked_url':
      return "That URL isn't allowed. Try a different one."
    case 'too_large':
      return 'That page is too large to read. Try a more specific URL.'
    case 'timeout':
      return 'Reading that URL timed out. Try again.'
    case 'attachment_limit_reached':
      return "You've reached the attachment limit for this conversation."
    default:
      return "Couldn't attach that link. Try again."
  }
}
