import { DirectJsonPromptGenerator, validatePayload } from '@a2ui/agent'
import {
  GENERATED_UI_A2UI_CATALOG_ID,
  GENERATED_UI_SEND_MESSAGE_EVENT,
  GENERATED_UI_TOOL,
  PresentGeneratedUiA2uiSchema,
} from '@goodparty_org/contracts'
import { generatedUiA2uiCatalog } from '@goodparty_org/contracts/genui-a2ui'
import type { LlmStreamTool } from '@/llm/services/llm.service'

const EXAMPLE = JSON.stringify({
  messages: [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'ui-1',
        catalogId: GENERATED_UI_A2UI_CATALOG_ID,
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'ui-1',
        components: [
          { id: 'root', component: 'Stack', children: ['title', 'stats', 'q'] },
          { id: 'title', component: 'Heading', text: 'District at a glance' },
          {
            id: 'stats',
            component: 'Stack',
            direction: 'horizontal',
            children: ['voters', 'turnout'],
          },
          {
            id: 'voters',
            component: 'Stat',
            label: 'Registered voters',
            value: { path: '/voters' },
          },
          {
            id: 'turnout',
            component: 'Stat',
            label: 'Turnout in 2024',
            value: '61%',
            delta: '+4 pts',
          },
          {
            id: 'q',
            component: 'ChoiceQuestion',
            question: 'What should we dig into?',
            options: ['Housing', 'Roads', 'Parks'],
            multi: true,
            value: { path: '/answer' },
            submit: {
              event: {
                name: GENERATED_UI_SEND_MESSAGE_EVENT,
                context: { choices: { path: '/answer' } },
              },
            },
          },
        ],
      },
    },
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId: 'ui-1',
        path: '/',
        value: { voters: '12,480', answer: [] },
      },
    },
  ],
})

// The SDK's own schema block: the v0.9 message schemas, the common types and
// this catalog's JSON, all generated from the shared catalog. Its workflow
// rules are left out because they describe <a2ui-json> tags in prose, and
// here the payload rides in a tool call instead.
const CATALOG_SCHEMA_BLOCK = new DirectJsonPromptGenerator(
  [generatedUiA2uiCatalog],
  undefined,
  ['createSurface', 'updateComponents', 'updateDataModel'],
).generateCatalogInstructions()

export const GENERATED_UI_RULES = [
  `GENERATED UI (apply whenever you call \`${GENERATED_UI_TOOL}\`):`,
  `- Call \`${GENERATED_UI_TOOL}\` when the user asks to see something: a dashboard of numbers, a comparison, a person to reach, a place on a map, a proposed piece of outreach, or options you built for them to pick from. For anything else, write prose.`,
  '- The input is {"messages": [...]}, a list of A2UI v0.9 messages: one `createSurface` with catalogId "' +
    GENERATED_UI_A2UI_CATALOG_ID +
    '", then one `updateComponents` with every component, then an `updateDataModel` if any component reads a path. Use one surfaceId per call.',
  '- Components are a flat list. Each has a unique `id` and a `component` name from the catalog below. One has the id "root" and comes first; parents come before their children and name them by id.',
  '- Use literal values, except for picks a ChoiceQuestion writes and values you want in the data model. A bound value reads {"path":"/key"} and gets its value from `updateDataModel`.',
  `- Buttons and question submits send the user's next message through a \`${GENERATED_UI_SEND_MESSAGE_EVENT}\` event. Do not also ask the same question with \`ask_clarify_question\`.`,
  '- Use only the components and properties in the catalog, and no function calls. Do not repeat the content of the UI in prose; one short line before the call is enough.',
  '- If the call returns an error, fix the payload and call it once more.',
  `- Example input: ${EXAMPLE}`,
  CATALOG_SCHEMA_BLOCK,
].join('\n')

// A no-op presenter like the cards: the call is the UI. Its args persist as
// the tool segment the webapp renders from, and a button press comes back as
// an ordinary user turn.
export const buildPresentGeneratedUiTool = (): LlmStreamTool<
  typeof PresentGeneratedUiA2uiSchema
> => ({
  description:
    'Show the user UI built from the generated UI component catalog: ' +
    'dashboards of stats, tables, contact cards, maps, outreach cards, ' +
    'choice questions and buttons. The input is a list of A2UI v0.9 ' +
    'messages. Follow the GENERATED UI rules in the system prompt.',
  inputSchema: PresentGeneratedUiA2uiSchema,
  execute: ({ messages }) => {
    try {
      validatePayload([generatedUiA2uiCatalog], messages)
      return { shown: true }
    } catch (err) {
      return {
        error: `The UI did not validate: ${err instanceof Error ? err.message : String(err)}. Fix it and call again.`,
      }
    }
  },
})
