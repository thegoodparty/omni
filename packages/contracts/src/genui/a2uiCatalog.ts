import { z } from 'zod-v3'
import { Catalog, CommonSchemas } from '@a2ui/web_core/v0_9'
import {
  GENERATED_UI_A2UI_CATALOG_ID,
  GENERATED_UI_SEND_MESSAGE_EVENT,
} from '../chats/GeneratedUiA2ui.schema'

// A2UI's binder and its catalog JSON both key off a "REF:#/$defs/<Type>|"
// description prefix, which is how web_core's own generated basic catalog
// writes them. Its dynamicString() helper would do this, but in 0.14.0 it
// writes a literal "${description}" instead of the text.
const dynamicString = (description: string) =>
  CommonSchemas.DynamicString.describe(
    `REF:#/$defs/DynamicString|${description}`,
  )
const dynamicNumber = (description: string) =>
  CommonSchemas.DynamicNumber.describe(
    `REF:#/$defs/DynamicNumber|${description}`,
  )
const dynamicStringList = (description: string) =>
  CommonSchemas.DynamicStringList.describe(
    `REF:#/$defs/DynamicStringList|${description}`,
  )
const action = (description: string) =>
  CommonSchemas.Action.describe(`REF:#/$defs/Action|${description}`)

export const StackApi = {
  name: 'Stack',
  schema: z
    .object({
      children: CommonSchemas.ChildList.describe(
        'REF:#/$defs/ChildList|Ids of the child components, in order.',
      ),
      direction: z
        .enum(['vertical', 'horizontal'])
        .describe('vertical stacks children, horizontal puts them in a row.')
        .optional(),
      gap: z
        .enum(['sm', 'md', 'lg'])
        .describe('Space between children.')
        .optional(),
    })
    .strict()
    .describe('Lays out its children in a column or a row.'),
}

export const HeadingApi = {
  name: 'Heading',
  schema: z
    .object({
      text: dynamicString('The title.'),
    })
    .strict()
    .describe('A short title above a group of content.'),
}

export const TextApi = {
  name: 'Text',
  schema: z
    .object({
      text: dynamicString('Plain text, no markdown.'),
      variant: z
        .enum(['body', 'muted'])
        .describe('muted is for captions and secondary lines.')
        .optional(),
    })
    .strict()
    .describe('A paragraph of body text.'),
}

export const StatApi = {
  name: 'Stat',
  schema: z
    .object({
      label: dynamicString('What the number is, like "Registered voters".'),
      value: dynamicString('The number as it should read, like "12,480".'),
      delta: dynamicString(
        'Optional change, like "+4% since 2022".',
      ).optional(),
      caption: dynamicString('Optional one-line source or note.').optional(),
    })
    .strict()
    .describe(
      'One headline number. Put several in a horizontal Stack for a dashboard.',
    ),
}

export const TableApi = {
  name: 'Table',
  schema: z
    .object({
      columns: dynamicStringList('Column headers.'),
      rows: z
        .array(z.array(z.string()))
        .describe('Rows of cells, one string per column, in column order.'),
    })
    .strict()
    .describe('A small table of strings, for comparisons.'),
}

export const ContactCardApi = {
  name: 'ContactCard',
  schema: z
    .object({
      name: dynamicString('Full name of the person or office.'),
      role: dynamicString('Their title, like "City Clerk".').optional(),
      organization: dynamicString('Where they work.').optional(),
      phone: dynamicString('Phone number, only if known.').optional(),
      email: dynamicString('Email address, only if known.').optional(),
      note: dynamicString('One line on why to reach them.').optional(),
    })
    .strict()
    .describe(
      'A person to reach, with Call and Email buttons and an "Ask about them" button that asks you about the person.',
    ),
}

export const MapCardApi = {
  name: 'MapCard',
  schema: z
    .object({
      title: dynamicString('What the map shows.'),
      center: z
        .object({ lat: z.number(), lng: z.number() })
        .strict()
        .describe('Where the map opens.'),
      zoom: z
        .number()
        .min(1)
        .max(18)
        .describe('1 is the world, 12 a city, 16 a few blocks.')
        .optional(),
      markers: z
        .array(
          z
            .object({ lat: z.number(), lng: z.number(), label: z.string() })
            .strict(),
        )
        .describe('Places to pin, each with a short label.'),
    })
    .strict()
    .describe('A map with labeled pins. Display only.'),
}

export const OutreachCardApi = {
  name: 'OutreachCard',
  schema: z
    .object({
      channel: z
        .enum(['text', 'call', 'door', 'social'])
        .describe('How the outreach goes out.'),
      audience: dynamicString('Who it reaches, like "Seniors in Ward 3".'),
      audienceCount: dynamicNumber('How many people it reaches.'),
      message: dynamicString('A preview of the message.'),
      ctaLabel: dynamicString(
        'Button label, like "Set up the text".',
      ).optional(),
    })
    .strict()
    .describe(
      'A proposed piece of outreach. Its button asks you to set it up.',
    ),
}

export const ChoiceQuestionApi = {
  name: 'ChoiceQuestion',
  schema: z
    .object({
      question: dynamicString('The question.'),
      options: dynamicStringList('Two to six short option labels.'),
      multi: z
        .boolean()
        .describe('true lets the user pick more than one option.')
        .optional(),
      value: dynamicStringList(
        'Bind to a data model path, like {"path":"/answer"}. The picked labels are written there.',
      ),
      submit: action(
        `Fired by the Submit button. Use {"event":{"name":"${GENERATED_UI_SEND_MESSAGE_EVENT}","context":{"choices":{"path":"/answer"}}}} with the same path as value.`,
      ),
    })
    .strict()
    .describe(
      'Asks the user to pick from options. Their picks come back to you as their next message.',
    ),
}

export const ActionButtonApi = {
  name: 'ActionButton',
  schema: z
    .object({
      label: dynamicString('Button label.'),
      action: action(
        `Use {"event":{"name":"${GENERATED_UI_SEND_MESSAGE_EVENT}","context":{"text":"<what the user says>"}}}. The text is sent as the user's next message.`,
      ),
      variant: z.enum(['primary', 'secondary']).optional(),
    })
    .strict()
    .describe('A button that sends a message for the user when pressed.'),
}

export const GENERATED_UI_A2UI_COMPONENT_APIS = [
  StackApi,
  HeadingApi,
  TextApi,
  StatApi,
  TableApi,
  ContactCardApi,
  MapCardApi,
  OutreachCardApi,
  ChoiceQuestionApi,
  ActionButtonApi,
]

// Schema only: gp-api prompts and validates against it. The webapp builds
// its own Catalog with the same id from React implementations of these APIs.
export const generatedUiA2uiCatalog = new Catalog(
  GENERATED_UI_A2UI_CATALOG_ID,
  'v0.9',
  GENERATED_UI_A2UI_COMPONENT_APIS,
  [],
)

export { GENERATED_UI_A2UI_CATALOG_ID, GENERATED_UI_SEND_MESSAGE_EVENT }
