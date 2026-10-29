import { z } from 'zod'
import {
  action,
  createLibrary,
  defineAction,
  defineComponent,
} from '@openuidev/lang-core'

export const OPEN_UI_OUTREACH_CHANNELS = [
  'text',
  'call',
  'door',
  'social',
] as const

export const OpenUiHeading = defineComponent({
  name: 'Heading',
  description: 'A short title for a section.',
  props: z.object({ text: z.string() }),
  component: null,
})

export const OpenUiText = defineComponent({
  name: 'Text',
  description: 'A paragraph of body text. "muted" is for a quiet caption.',
  props: z.object({
    text: z.string(),
    variant: z.enum(['default', 'muted']).optional(),
  }),
  component: null,
})

export const OpenUiStat = defineComponent({
  name: 'Stat',
  description:
    'One number with its label, e.g. Stat("Registered voters", "12,400", "+3% since 2022"). Put several in a horizontal Stack for a dashboard.',
  props: z.object({
    label: z.string(),
    value: z.union([z.string(), z.number()]),
    delta: z.string().optional(),
    caption: z.string().optional(),
  }),
  component: null,
})

export const OpenUiTable = defineComponent({
  name: 'Table',
  description:
    'A comparison table. columns are the header labels; each row has one cell per column.',
  props: z.object({
    columns: z.array(z.string()),
    rows: z.array(z.array(z.union([z.string(), z.number()]))),
  }),
  component: null,
})

export const OpenUiContactCard = defineComponent({
  name: 'ContactCard',
  description:
    'A person to reach. The card adds Call and Email buttons from phone and email, and an Ask about them button. Pass null for an unknown middle field.',
  props: z.object({
    name: z.string(),
    role: z.string().optional(),
    organization: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    note: z.string().optional(),
  }),
  component: null,
})

export const OpenUiMapCard = defineComponent({
  name: 'MapCard',
  description:
    'A map centered on a place, with labeled pins. zoom is 1 (world) to 18 (street); 13 shows a town.',
  props: z.object({
    title: z.string(),
    center: z.object({ lat: z.number(), lng: z.number() }),
    zoom: z.number().optional(),
    markers: z
      .array(z.object({ lat: z.number(), lng: z.number(), label: z.string() }))
      .optional(),
  }),
  component: null,
})

export const OpenUiOutreachCard = defineComponent({
  name: 'OutreachCard',
  description:
    'A proposed piece of outreach: the channel, who it reaches, how many people, the message, and a button to set it up.',
  props: z.object({
    channel: z.enum(OPEN_UI_OUTREACH_CHANNELS),
    audience: z.string(),
    audienceCount: z.number(),
    message: z.string(),
    ctaLabel: z.string().optional(),
  }),
  component: null,
})

export const OpenUiChoiceQuestion = defineComponent({
  name: 'ChoiceQuestion',
  description:
    'Ask the user to pick from 2 to 5 options. multi true lets them pick several. Their answer comes back as their next message.',
  props: z.object({
    question: z.string(),
    options: z.array(z.string()),
    multi: z.boolean().optional(),
  }),
  component: null,
})

export const OpenUiActionButton = defineComponent({
  name: 'ActionButton',
  description:
    'A button. Give it @ToAssistant("message") to send that message as the user, or @StartOutreach(channel).',
  props: z.object({
    label: z.string(),
    action: action(),
  }),
  component: null,
})

const OpenUiStackProps = z.object({
  get children() {
    return z.array(
      z.union([
        OpenUiStackProps,
        OpenUiHeading.ref,
        OpenUiText.ref,
        OpenUiStat.ref,
        OpenUiTable.ref,
        OpenUiContactCard.ref,
        OpenUiMapCard.ref,
        OpenUiOutreachCard.ref,
        OpenUiChoiceQuestion.ref,
        OpenUiActionButton.ref,
      ]),
    )
  },
  direction: z.enum(['vertical', 'horizontal']).optional(),
  gap: z.enum(['small', 'medium', 'large']).optional(),
})

export const OpenUiStack = defineComponent({
  name: 'Stack',
  description:
    'Lays out children vertically (default) or horizontally. Nest Stacks for rows inside a column.',
  props: OpenUiStackProps,
  component: null,
})

export const OpenUiStartOutreach = defineAction({
  name: 'StartOutreach',
  description: 'Start setting up outreach on one channel.',
  params: z.object({ channel: z.enum(OPEN_UI_OUTREACH_CHANNELS) }),
})

export const openUiCatalog = createLibrary({
  root: 'Stack',
  components: [
    OpenUiStack,
    OpenUiHeading,
    OpenUiText,
    OpenUiStat,
    OpenUiTable,
    OpenUiContactCard,
    OpenUiMapCard,
    OpenUiOutreachCard,
    OpenUiChoiceQuestion,
    OpenUiActionButton,
  ],
  actions: [OpenUiStartOutreach],
})
