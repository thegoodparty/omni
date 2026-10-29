import {
  ActionBindingSchema,
  VisibilityConditionSchema,
  defineCatalog,
  defineSchema,
  validateSpec,
} from '@json-render/core'
import { schema } from '@json-render/react/schema'
import { z } from 'zod'

export const PRESENT_GENERATED_UI_TOOL = 'present_generated_ui'

export const OUTREACH_CARD_CHANNELS = [
  'text',
  'call',
  'door',
  'social',
] as const

const GENERATED_UI_ACTIONS = {
  send_message: {
    params: z.object({ text: z.string() }),
    description: "Send text as the user's next chat message.",
  },
  submit_choices: {
    params: z.object({ choices: z.array(z.string()) }),
    description:
      "Send the chosen option labels as the user's next chat message.",
  },
}

// The stock catalog.prompt() teaches a JSONL patch stream in a ```spec fence
// and asks for invented sample data. Our spec arrives whole as a tool input,
// so the React schema is reused as is with a prompt template that keeps the
// library's prop formatting and drops the stream format.
const generatedUiSchema = defineSchema(() => schema.definition, {
  builtInActions: schema.builtInActions,
  promptTemplate: ({ catalog, formatZodType }) => {
    const { components } = catalog as {
      components: Record<
        string,
        { props: z.ZodType; description?: string; slots?: string[] }
      >
    }
    return [
      `The input of ${PRESENT_GENERATED_UI_TOOL} is a json-render spec, one JSON object:`,
      '{"root":"<key>","elements":{"<key>":{"type":"<Component>","props":{...},"children":["<key>"]}},"state":{...}}',
      '- Every element has type, props and children. Leaves use "children": []. Every key in children must exist in elements.',
      '- "on" and "visible" go on the element, never inside props.',
      '- "state" is optional. It seeds values that props read with {"$state":"/path"} or bind two-way with {"$bindState":"/path"}.',
      '- An event binding is "on":{"<event>":{"action":"<action>","params":{...}}}. Params can read state with {"$state":"/path"}.',
      '',
      'Components:',
      ...Object.entries(components).map(
        ([name, component]) =>
          `- ${name}: ${formatZodType(component.props)} - ${component.description ?? ''}${component.slots?.length ? ' [accepts children]' : ''}`,
      ),
      '',
      'Actions:',
      ...Object.entries(GENERATED_UI_ACTIONS).map(
        ([name, action]) =>
          `- ${name}: ${formatZodType(action.params)} - ${action.description}`,
      ),
      '',
      'Show only facts from this conversation or your tools. Never invent numbers, people or contact details to fill a component.',
    ].join('\n')
  },
})

// One definition for both sides: gp-api builds the prompt and checks the tool
// input from it, gp-webapp binds React components to the same names. The data
// is exported rather than the catalog because json-render resolves its own
// nested zod copy, and a d.ts cannot name a type from it.
export const GENERATED_UI_CATALOG_DATA = {
  components: {
    Stack: {
      props: z.object({
        direction: z.enum(['vertical', 'horizontal']).optional(),
        gap: z.enum(['small', 'medium', 'large']).optional(),
      }),
      slots: ['default'],
      description:
        'Layout container. Stacks its children vertically (default) or side by side. Use it as the root when showing more than one thing.',
    },
    Heading: {
      props: z.object({
        text: z.string(),
        level: z.enum(['title', 'section']).optional(),
      }),
      description: 'A title or section heading.',
    },
    Text: {
      props: z.object({
        text: z.string(),
        variant: z.enum(['default', 'muted']).optional(),
      }),
      description:
        'A short paragraph of body text. Use variant muted for captions and footnotes.',
    },
    Stat: {
      props: z.object({
        label: z.string(),
        value: z.string(),
        delta: z.string().optional(),
        caption: z.string().optional(),
      }),
      description:
        'One number with its label, like a dashboard tile. delta is a short change like "+4% since May". Put several in a horizontal Stack.',
    },
    Table: {
      props: z.object({
        columns: z.array(z.string()),
        rows: z.array(z.array(z.string())),
      }),
      description:
        'A comparison table. Every row has one string per column, in column order.',
    },
    ContactCard: {
      props: z.object({
        name: z.string(),
        role: z.string().optional(),
        organization: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        note: z.string().optional(),
      }),
      description:
        'A person to reach, with Call and Email buttons for the routes given and an "Ask about them" button (event "ask", defaults to asking about them). Never invent a phone or email.',
    },
    MapCard: {
      props: z.object({
        title: z.string(),
        center: z.object({ lat: z.number(), lng: z.number() }),
        zoom: z.number().min(1).max(18),
        markers: z.array(
          z.object({ lat: z.number(), lng: z.number(), label: z.string() }),
        ),
      }),
      description:
        'A map of places with labeled pins. Display only. zoom 13 shows a city, 16 a few blocks.',
    },
    OutreachCard: {
      props: z.object({
        channel: z.enum(OUTREACH_CARD_CHANNELS),
        audience: z.string(),
        audienceCount: z.number().int().nonnegative(),
        messagePreview: z.string(),
        ctaLabel: z.string(),
      }),
      description:
        'A proposed outreach: who, how many, the channel and a preview of the message. Its button (event "press") defaults to asking to set up that outreach.',
    },
    ChoiceQuestion: {
      props: z.object({
        question: z.string(),
        options: z.array(z.string()).min(2),
        multi: z.boolean(),
        value: z.array(z.string()).optional(),
      }),
      description:
        'A question the user answers by picking options and pressing Submit (event "submit"). multi true allows several picks. Bind value with {"$bindState":"/answers/<id>"}, seed state.answers.<id> with [], and set on.submit to submit_choices with params {"choices":{"$state":"/answers/<id>"}}.',
    },
    ActionButton: {
      props: z.object({
        label: z.string(),
        message: z.string(),
      }),
      description:
        'A button (event "press") that sends message as the user\'s next chat message, for a suggested next step.',
    },
  },
  actions: GENERATED_UI_ACTIONS,
}

const generatedUiCatalog = defineCatalog(
  generatedUiSchema,
  GENERATED_UI_CATALOG_DATA,
)

export const GENERATED_UI_PROMPT = generatedUiCatalog.prompt()

const EventBindingsSchema = z
  .record(
    z.string(),
    z.union([ActionBindingSchema, z.array(ActionBindingSchema)]),
  )
  .optional()

// The tool input. Deliberately looser than the catalog: catalog.zodSchema()
// strips "on", "watch" and "state" and checks props only when a catalog has
// one component, so props and bindings are checked in checkGeneratedUiSpec.
export const GeneratedUiSpecSchema = z.object({
  root: z.string(),
  elements: z.record(
    z.string(),
    z.object({
      type: z.string(),
      props: z.record(z.string(), z.unknown()),
      children: z.array(z.string()),
      slots: z.record(z.string(), z.array(z.string())).optional(),
      visible: VisibilityConditionSchema.optional(),
      on: EventBindingsSchema,
      repeat: z
        .object({
          statePath: z.union([z.string(), z.object({ $item: z.string() })]),
          key: z.string().optional(),
        })
        .optional(),
      watch: EventBindingsSchema,
    }),
  ),
  state: z.record(z.string(), z.unknown()).optional(),
})

export type GeneratedUiSpec = z.infer<typeof GeneratedUiSpecSchema>

const isPropExpression = (value: unknown) =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).some((key) => key.startsWith('$'))

const KNOWN_ACTIONS = new Set([
  ...generatedUiCatalog.actionNames,
  ...(schema.builtInActions ?? []).map((action) => action.name),
])

// Every problem a model could fix, as lines it can read. Empty means render.
export const checkGeneratedUiSpec = (spec: GeneratedUiSpec): string[] => {
  const issues: string[] = []
  const catalogCheck = generatedUiCatalog.validate(spec)
  if (!catalogCheck.success) {
    issues.push(
      ...(catalogCheck.error?.issues ?? []).map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      ),
    )
  }
  issues.push(
    ...validateSpec(spec)
      .issues.filter((issue) => issue.severity === 'error')
      .map((issue) => issue.message),
  )
  const components: Record<string, { props: z.ZodType }> =
    generatedUiCatalog.data.components
  for (const [key, element] of Object.entries(spec.elements)) {
    const component = components[element.type]
    if (!component) continue
    const bound = Object.keys(element.props).filter((prop) =>
      isPropExpression(element.props[prop]),
    )
    const propsCheck = component.props.safeParse(element.props)
    if (!propsCheck.success) {
      issues.push(
        ...propsCheck.error.issues
          .filter((issue) => !bound.includes(String(issue.path[0])))
          .map(
            (issue) =>
              `elements.${key}.props.${issue.path.join('.')}: ${issue.message}`,
          ),
      )
    }
    for (const [event, binding] of Object.entries(element.on ?? {})) {
      for (const { action } of [binding].flat()) {
        if (!KNOWN_ACTIONS.has(action)) {
          issues.push(`elements.${key}.on.${event}: unknown action "${action}"`)
        }
      }
    }
  }
  return issues
}
