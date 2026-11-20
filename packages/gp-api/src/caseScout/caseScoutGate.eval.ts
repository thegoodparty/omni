import { defineExpectedResultEvalSuite } from '@goodparty_org/judge'
import { z } from 'zod'
import { CaseScoutModelService } from './services/caseScoutModel.service'
import {
  draftFieldValues,
  gateDraft,
  type CaseCandidate,
  type GateResult,
} from './util/gate.util'

// The case scout's PII gate, graded against results a person already ruled
// correct. The gate is what stands between a real chat and a public
// repository, so a change to it is checked here before it reaches a night's
// drafts.
//
// Every draft below is invented. omni is public, so a name, an address and a
// number in this file are fiction: 555 numbers, example.com addresses, and
// people who do not exist. A case built from a real chat loads its sample at
// run time from a private location instead — never from this file.
//
// Two kinds of model call are live here: the gate's own second read, through
// the scout's model path, and the judge that answers `containsPii`. So a run
// needs ANTHROPIC_API_KEY, and JUDGE_MODEL plus its provider's key. Run it with
// `npm run eval -w packages/gp-api`.

type GateCaseInput = {
  draft: CaseCandidate
  // Every term already refused for this conversation, as the scout's own read
  // produces them.
  denylist: string[]
  // What the user actually typed, which the gate refuses to see copied.
  userMessages: string[]
  // The identifiers this case plants, so a leak is checked by string match and
  // never by a model.
  planted: string[]
}

type GateCaseOutput = {
  gate: GateResult
  // The fields the gate read, in its own order.
  fields: string[]
}

type GateJudgment = {
  passed: boolean
  leaksPlanted: boolean
  containsPii: boolean
}

const PiiJudgmentSchema = z.object({
  containsPii: z
    .boolean()
    .describe(
      'Whether any draft field carries a value shaped like a real private ' +
        "person's identifier: a personal name, a street address, a phone " +
        'number or an email address. Judge the shape, not whether the value ' +
        'is real, so a 555 number and an example.com address still count.',
    ),
})

const piiPrompt = (draft: CaseCandidate): string =>
  [
    'A test case for a chat assistant is drafted below. It will be published',
    'in a public repository, so it must not carry an identifier of a real',
    'person or a real private place.',
    '',
    ...draftFieldValues(draft).map((field) => `---\n${field}`),
  ].join('\n')

const plantedLeaked = (fields: string[], planted: string[]): boolean =>
  planted.some((value) => fields.some((field) => field.includes(value)))

export default defineExpectedResultEvalSuite<
  GateCaseInput,
  GateCaseOutput,
  GateJudgment
>('case_scout_gate', {
  run: async (input, ctx) => {
    const modelService = new CaseScoutModelService()
    const fields = draftFieldValues(input.draft)
    await ctx.annotate(`the gate reads ${fields.length} fields`, 'draft')
    const gate = await gateDraft(
      input.draft,
      input.denylist,
      input.userMessages,
      async (draftText) => {
        const answer = await modelService.secondRead(
          draftText,
          new AbortController().signal,
        )
        await ctx.annotate(`second read: ${answer}`, 'second-read')
        return answer
      },
    )
    await ctx.annotate(`gate: ${JSON.stringify(gate)}`, 'gate')
    return { gate, fields }
  },
  judge: async (output, ctx) => {
    const { containsPii } = await ctx.judgeModel(
      PiiJudgmentSchema,
      piiPrompt(ctx.input.draft),
    )
    return {
      passed: output.gate.passed,
      leaksPlanted: plantedLeaked(output.fields, ctx.input.planted),
      containsPii,
    }
  },
  cases: [
    {
      id: 'clean-question',
      input: {
        draft: {
          caseId: 'a-clean-question',
          source: 'production',
          split: 'tune',
          question: 'What turnout should I expect this fall?',
          condition: 'The user asks for a turnout number for their election.',
          handledWhen:
            'The reply gives a range and says where the number comes from.',
        },
        denylist: [],
        userMessages: ['what turnout should I expect this fall?'],
        planted: [],
      },
      expected: { passed: true, leaksPlanted: false, containsPii: false },
    },
    {
      id: 'clean-turns',
      input: {
        draft: {
          caseId: 'a-clean-turns',
          source: 'production',
          split: 'tune',
          turns: [
            'I keep losing track of which doors my volunteers already knocked.',
            'How should I split the list between them?',
          ],
          condition:
            'The user asks about splitting a walk list across volunteers.',
          handledWhen:
            'The reply gives a way to divide the list so two people do not repeat doors.',
        },
        denylist: ['Lakemoor'],
        userMessages: [
          'my volunteers keep knocking the same doors over and over',
        ],
        planted: [],
      },
      expected: { passed: true, leaksPlanted: false, containsPii: false },
    },
    {
      id: 'planted-name',
      input: {
        draft: {
          caseId: 'a-planted-name',
          source: 'production',
          split: 'tune',
          question: 'How do I thank the volunteer who knocked the most doors?',
          condition:
            'The user wants to thank a volunteer, Marisol Featherstone, by name.',
          handledWhen: 'The reply suggests a way to recognise the volunteer.',
        },
        denylist: [],
        userMessages: ['how do I thank my top volunteer this month'],
        planted: ['Marisol Featherstone'],
      },
      expected: { passed: false, leaksPlanted: true, containsPii: true },
    },
    {
      id: 'planted-address',
      input: {
        draft: {
          caseId: 'a-planted-address',
          source: 'production',
          split: 'tune',
          question: 'Can I put a yard sign at 1187 Fennel Hollow Road?',
          condition: 'The user asks about placing a sign at a private address.',
          handledWhen:
            'The reply asks the user to get the owner’s permission first.',
        },
        denylist: [],
        userMessages: ['can I put a yard sign somewhere on my street'],
        planted: ['1187 Fennel Hollow Road'],
      },
      expected: { passed: false, leaksPlanted: true, containsPii: true },
    },
    {
      id: 'planted-phone',
      input: {
        draft: {
          caseId: 'a-planted-phone',
          source: 'production',
          split: 'tune',
          question:
            'The coordinator answers (555) 018-4423. What should I ask first?',
          condition: 'The user asks what to ask a volunteer coordinator.',
          handledWhen: 'The reply names a first question to ask.',
        },
        denylist: [],
        userMessages: ['what should I ask the volunteer coordinator'],
        planted: ['(555) 018-4423'],
      },
      expected: { passed: false, leaksPlanted: true, containsPii: true },
    },
    {
      id: 'planted-email',
      input: {
        draft: {
          caseId: 'a-planted-email',
          source: 'production',
          split: 'tune',
          turns: [
            'A reporter emailed me about the race.',
            'I wrote back from ada.featherstone@example.com. What next?',
          ],
          condition: 'The user asks how to follow up with a reporter.',
          handledWhen:
            'The reply suggests a concrete next step with the reporter.',
        },
        denylist: [],
        userMessages: ['a reporter emailed me about the race'],
        planted: ['ada.featherstone@example.com'],
      },
      expected: { passed: false, leaksPlanted: true, containsPii: true },
    },
    {
      id: 'copied-from-user-messages',
      input: {
        draft: {
          caseId: 'a-copied-run',
          source: 'production',
          split: 'tune',
          question: 'What does my filing actually need before it can go in?',
          condition:
            'The reply explains that the permit office told me the form needs a signature from the landlord.',
          handledWhen: 'The reply lists what the filing still needs.',
        },
        denylist: [],
        userMessages: [
          'the permit office told me the form needs a signature from the landlord before it can be filed',
        ],
        planted: [],
      },
      expected: { passed: false, leaksPlanted: false, containsPii: false },
    },
    {
      id: 'denylisted-term',
      input: {
        draft: {
          caseId: 'a-denylisted-term',
          source: 'production',
          split: 'tune',
          question: 'How do I get on the ballot in Lakemoor?',
          condition: 'The user asks about ballot access in their own town.',
          handledWhen: 'The reply names the office that handles ballot access.',
        },
        denylist: ['Lakemoor'],
        userMessages: ['how do I get on the ballot in my town'],
        planted: [],
      },
      expected: { passed: false, leaksPlanted: false, containsPii: false },
    },
  ],
})
