import { z } from 'zod'

const httpsUrl = z
  .string()
  .max(2000)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:'
    } catch {
      return false
    }
  }, 'Links must be https')

export const emailTemplateContentSchema = z.object({
  subject: z.string().max(150),
  headline: z.string().max(150).nullish(),
  body: z.string().max(10_000),
  imageUrl: httpsUrl.nullish(),
  button: z.object({ label: z.string().max(40), url: httpsUrl }).nullish(),
  footer: z.object({
    senderName: z.string(),
    // Win shows "Paid for by"; Serve passes null and gets no line.
    paidForBy: z.string().nullish(),
  }),
})

export type EmailTemplateContent = z.infer<typeof emailTemplateContentSchema>

export type RenderedEmailTemplate = {
  html: string
  text: string
  subject: string
}
