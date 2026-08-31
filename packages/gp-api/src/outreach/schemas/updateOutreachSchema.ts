import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { P2P_SCRIPT_MAX_LENGTH } from '@goodparty_org/contracts'

// Edit-before-send for a scheduled P2P SMS campaign. The client always sends
// the complete current values (Peerly's template update is a destructive
// overwrite, so partial edits have no vendor-side meaning); the audience and
// price are deliberately not editable — that path is cancel-and-recreate.
export class UpdateOutreachSchema extends createZodDto(
  z
    .object({
      name: z.string().min(1).max(255),
      // Multipart encoding rewrites lone LF to CRLF in field values, so the
      // wire length exceeds what the client counted; normalize before the
      // length check (same handling as createOutreachSchema).
      script: z
        .string()
        .min(1)
        .transform((s) => s.replace(/\r\n/g, '\n'))
        .refine(
          (s) => s.length <= P2P_SCRIPT_MAX_LENGTH,
          `Script cannot exceed ${P2P_SCRIPT_MAX_LENGTH} characters`,
        ),
      date: z.string().datetime({ offset: true }),
    })
    .strict(),
) {}
