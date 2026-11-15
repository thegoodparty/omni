import { z } from 'zod'

// The data of the `panelRepliesUploaded` queue message: EventBridge turns the
// swarm's S3 upload of a wave's reply export into it.
export const PanelRepliesUploadedEventSchema = z.object({
  bucket: z.string(),
  key: z.string(),
})
export type PanelRepliesUploadedEvent = z.infer<
  typeof PanelRepliesUploadedEventSchema
>
