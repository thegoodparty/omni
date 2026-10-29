import {
  PRESENT_GENERATED_UI_TOOL,
  PresentGeneratedUiSchema,
} from '@goodparty_org/contracts'
import { openUiCatalog } from '@goodparty_org/contracts/openui'
import { createParser } from '@openuidev/lang-core'
import type { LlmStreamTool } from '@/llm/services/llm.service'

const OPEN_UI_PREAMBLE =
  `\`${PRESENT_GENERATED_UI_TOOL}\` draws a small custom UI in the chat from an openui-lang program, ` +
  'a declarative UI language. Only the `program` argument is openui-lang; your chat text stays plain prose. ' +
  'The rest of this block is the openui-lang reference for that argument.'

const OPEN_UI_EXAMPLE = [
  'Example `program` (a district dashboard):',
  'root = Stack([title, stats, table])',
  'title = Heading("Your district at a glance")',
  'stats = Stack([s1, s2, s3], "horizontal")',
  's1 = Stat("Residents", "48,200")',
  's2 = Stat("Registered voters", "31,050", "+4% since 2022")',
  's3 = Stat("Turnout last election", "38%", null, "Municipal, 2023")',
  'table = Table(["Issue", "Share who rank it first"], [["Housing costs", "34%"], ["Roads", "21%"]])',
].join('\n')

const OPEN_UI_RULES = [
  `Call \`${PRESENT_GENERATED_UI_TOOL}\` when the user asks to see something visually: a dashboard of numbers, a comparison, a person, a place on a map, a proposed piece of outreach as a card, or a question they answer by picking options. When the user asks for a card, a dashboard, a map or a pick-from-options question, prefer it over the other card tools.`,
  `This chat is where we try generated UI out, so two requests go to \`${PRESENT_GENERATED_UI_TOOL}\` even though another tool could serve them: when the user asks you to ask them something as a multi-select (or pick-one) question, draw a ChoiceQuestion instead of calling \`ask_clarify_question\`; when the user asks for outreach "as a card", draw an OutreachCard instead of calling \`present_outreach_proposal\`.`,
  'Never use a component that is not listed above, such as Button or Card: buttons are ActionButton, and a card is one of ContactCard, MapCard or OutreachCard.',
  'Write one short line of prose before the call. Never repeat in prose what the UI shows.',
  `If the tool returns an error, fix the program and call \`${PRESENT_GENERATED_UI_TOOL}\` again once.`,
]

export const OPEN_UI_PROMPT_BLOCK = openUiCatalog.prompt({
  preamble: OPEN_UI_PREAMBLE,
  examples: [OPEN_UI_EXAMPLE],
  additionalRules: OPEN_UI_RULES,
})

const parser = createParser(openUiCatalog.toJSONSchema(), openUiCatalog.root)

// A no-op presenter like the other present_* tools: the program is the
// widget payload. Parsing it against the same catalog the webapp renders
// turns a program that would render broken into a refusal the model fixes.
export const buildPresentGeneratedUiTool = (): LlmStreamTool<
  typeof PresentGeneratedUiSchema
> => ({
  description:
    'Show a small custom UI in the chat (stats, tables, a contact card, a map, an outreach card, a choice question, buttons). ' +
    'Pass an openui-lang program built only from the components in the openui-lang block of your instructions.',
  inputSchema: PresentGeneratedUiSchema,
  execute: ({ program }) => {
    const result = parser.parse(program)
    const problems = [
      ...result.meta.errors
        .filter((error) => error.severity !== 'warning')
        .map((error) =>
          error.statementId
            ? `${error.statementId}: ${error.message}`
            : error.message,
        ),
      ...result.meta.unresolved.map(
        (name) => `${name} is referenced but never defined`,
      ),
    ]
    if (!result.root || problems.length > 0) {
      return {
        error:
          'The program did not render. Fix these and call again: ' +
          (problems.length > 0 ? problems.join('; ') : 'there is no root'),
      }
    }
    return { shown: true, dropped: result.meta.orphaned }
  },
})
