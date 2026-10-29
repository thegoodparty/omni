import { z } from 'zod'

export const PRESENT_GENERATED_UI_TOOL = 'present_generated_ui'

export const PresentGeneratedUiSchema = z.object({
  program: z
    .string()
    .min(1)
    .max(20000)
    .describe(
      'An openui-lang program, one `name = Expression` statement per line, starting with `root = Stack(...)`.',
    ),
})

export type PresentGeneratedUi = z.infer<typeof PresentGeneratedUiSchema>
