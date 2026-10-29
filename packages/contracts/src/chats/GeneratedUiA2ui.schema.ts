import { z } from 'zod'

export const GENERATED_UI_TOOL = 'present_generated_ui'

export const GENERATED_UI_A2UI_CATALOG_ID =
  'https://goodparty.org/a2ui/v0_9/chief-of-staff/catalog.json'

// The one event the host acts on. Its context carries either `text`, sent as
// written, or `choices`, a list of picked labels joined into one line.
export const GENERATED_UI_SEND_MESSAGE_EVENT = 'send_message'

const A2uiVersionSchema = z.literal('v0.9')

// Component props differ per catalog entry, so they are left open here and
// checked against the catalog by the A2UI SDK in the tool's execute.
const A2uiComponentSchema = z
  .object({
    id: z.string().min(1),
    component: z.string().min(1),
  })
  .catchall(z.unknown())

const A2uiMessageSchema = z.union([
  z
    .object({
      version: A2uiVersionSchema,
      createSurface: z
        .object({
          surfaceId: z.string().min(1),
          catalogId: z.string().min(1),
          sendDataModel: z.boolean().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      version: A2uiVersionSchema,
      updateComponents: z
        .object({
          surfaceId: z.string().min(1),
          components: z.array(A2uiComponentSchema).min(1),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      version: A2uiVersionSchema,
      updateDataModel: z
        .object({
          surfaceId: z.string().min(1),
          path: z.string().optional(),
          value: z.unknown().optional(),
        })
        .strict(),
    })
    .strict(),
])

// The A2UI v0.9 "server to client message list wrapper": the tool input is
// the protocol payload itself, so the renderer takes it as it arrives.
export const PresentGeneratedUiA2uiSchema = z.object({
  messages: z.array(A2uiMessageSchema).min(1).max(12),
})

export type PresentGeneratedUiA2ui = z.infer<
  typeof PresentGeneratedUiA2uiSchema
>
