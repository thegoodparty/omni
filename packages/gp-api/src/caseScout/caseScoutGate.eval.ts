import { defineExpectedResultEvalSuite } from '@goodparty_org/judge'
import { CaseScoutModelService } from './services/caseScoutModel.service'
import {
  gateDraft,
  gateNeedsSetup,
  type CaseCandidate,
  type GateRule,
  type SecondReadCall,
} from './util/gate.util'

// The detector: the case scout's PII gate alone, fed hand-written drafts. A
// draft goes in and the judgment is whether the gate blocked it and which
// rule did. Each expected value is what a person rules correct, even where
// today's gate misses it (a seven-digit phone, a draft that identifies a
// place with no name in it), so a red case here is a finding about the gate.
// caseScoutDeidentifier.eval.ts grades the whole exit path instead.
//
// Every draft below is invented. omni is public, so a name, an address and a
// number in this file are fiction: 555 numbers, example.com addresses, and
// people and towns that do not exist. Never commit a real sample, and never
// load one into a report.
//
// The only model call is the gate's own second read, so a run needs
// ANTHROPIC_API_KEY and no JUDGE_MODEL. Run it with
// `npm run eval -w packages/gp-api`.

type GateCaseInput = {
  // A drafted case, or the one line a needs-setup answer carries.
  draft: CaseCandidate | { needsSetup: string }
  // Every term already refused for this conversation, as the scout's own read
  // produces them.
  denylist: string[]
  // The session's user and assistant turns and tool inputs. The gate refuses
  // an 8-word run copied from them only when the run carries a number or a
  // mid-sentence capital: copied conversation is fine without PII in it.
  sourceTexts: string[]
}

type GateJudgment = { blocked: boolean; rule: GateRule | null }

const draft = (fields: Partial<CaseCandidate>): CaseCandidate => ({
  caseId: 'a-drafted-case',
  source: 'production',
  split: 'tune',
  condition: 'The user asks a question the reply must answer.',
  handledWhen: 'The reply answers the question.',
  ...fields,
})

export default defineExpectedResultEvalSuite('case_scout_gate', {
  run: async (input: GateCaseInput, ctx) => {
    const modelService = new CaseScoutModelService()
    const secondRead: SecondReadCall = async (draftText) => {
      const answer = await modelService.secondRead(
        draftText,
        new AbortController().signal,
      )
      await ctx.annotate(`second read: ${answer}`, 'second-read')
      return answer
    }
    return 'needsSetup' in input.draft
      ? gateNeedsSetup(
          input.draft.needsSetup,
          input.denylist,
          input.sourceTexts,
          secondRead,
        )
      : gateDraft(input.draft, input.denylist, input.sourceTexts, secondRead)
  },
  judge: async (gate): Promise<GateJudgment> => ({
    blocked: !gate.passed,
    rule: gate.passed ? null : gate.rule,
  }),
  cases: [
    {
      id: 'clean-question',
      input: {
        draft: draft({
          caseId: 'turnout-without-a-source',
          question: 'What turnout should I expect this fall?',
          condition: 'The user asks for a turnout number for their election.',
          handledWhen:
            'The reply gives a range and says where the number comes from.',
        }),
        denylist: [],
        sourceTexts: ['what turnout should I expect this fall?'],
      },
      expected: { blocked: false, rule: null },
    },
    {
      id: 'clean-turns',
      input: {
        draft: draft({
          caseId: 'split-walk-list',
          turns: [
            'I keep losing track of which doors my volunteers already knocked.',
            'How should I split the list between them?',
          ],
          condition:
            'The user asks about splitting a walk list across volunteers.',
          handledWhen:
            'The reply gives a way to divide the list so two people do not repeat doors.',
        }),
        denylist: ['Lakemoor'],
        sourceTexts: [
          'my volunteers keep knocking the same doors over and over',
        ],
      },
      expected: { blocked: false, rule: null },
    },
    {
      id: 'clean-needs-setup',
      input: {
        draft: {
          needsSetup:
            'An account with a primary election in the next two weeks.',
        },
        denylist: ['Lakemoor'],
        sourceTexts: ['is my primary soon enough to start texting?'],
      },
      expected: { blocked: false, rule: null },
    },
    {
      id: 'name',
      input: {
        draft: draft({
          question: 'How do I thank the volunteer who knocked the most doors?',
          condition:
            'The user wants to thank a volunteer, Marisol Featherstone, by name.',
          handledWhen: 'The reply suggests a way to recognise the volunteer.',
        }),
        denylist: [],
        sourceTexts: ['how do I thank my top volunteer this month'],
      },
      expected: { blocked: true, rule: 'secondRead' },
    },
    {
      id: 'address',
      input: {
        draft: draft({
          question: 'Can I put a yard sign at 1187 Fennel Hollow Road?',
          condition: 'The user asks about placing a sign at a private address.',
          handledWhen:
            'The reply asks the user to get the owner’s permission first.',
        }),
        denylist: [],
        sourceTexts: ['can I put a yard sign somewhere on my street'],
      },
      expected: { blocked: true, rule: 'secondRead' },
    },
    {
      id: 'email',
      input: {
        draft: draft({
          turns: [
            'A reporter emailed me about the race.',
            'I wrote back from ada.featherstone@example.com. What next?',
          ],
          condition: 'The user asks how to follow up with a reporter.',
          handledWhen:
            'The reply suggests a concrete next step with the reporter.',
        }),
        denylist: [],
        sourceTexts: ['a reporter emailed me about the race'],
      },
      expected: { blocked: true, rule: 'contactPattern' },
    },
    {
      id: 'phone-ten-digit',
      input: {
        draft: draft({
          question:
            'The coordinator answers (555) 018-4423. What should I ask first?',
          condition: 'The user asks what to ask a volunteer coordinator.',
          handledWhen: 'The reply names a first question to ask.',
        }),
        denylist: [],
        sourceTexts: ['what should I ask the volunteer coordinator'],
      },
      expected: { blocked: true, rule: 'contactPattern' },
    },
    {
      id: 'phone-seven-digit',
      input: {
        draft: draft({
          question:
            'The clerk’s direct line is 555-0193. Can you write a voicemail asking about the hearing?',
          condition: 'The user asks for a voicemail script for the clerk.',
          handledWhen:
            'The reply writes a short voicemail and invents no hearing date.',
        }),
        denylist: [],
        sourceTexts: ['write a voicemail for the clerk about the hearing'],
      },
      expected: { blocked: true, rule: 'contactPattern' },
    },
    {
      id: 'copied-from-user-messages',
      input: {
        draft: draft({
          question: 'What does my filing actually need before it can go in?',
          condition:
            'The reply explains that the permit office told me the form needs a signature from the landlord.',
          handledWhen: 'The reply lists what the filing still needs.',
        }),
        denylist: [],
        sourceTexts: [
          'the permit office told me the form needs a signature from the landlord before it can be filed',
        ],
      },
      expected: { blocked: false, rule: null },
    },
    {
      id: 'copied-generic-from-tool-input',
      input: {
        draft: draft({
          question:
            'Can you remind everyone to bring water and comfortable shoes to the volunteer shift?',
          condition: 'The user asks for a reminder to send to volunteers.',
          handledWhen: 'The reply writes a short reminder for the volunteers.',
        }),
        denylist: [],
        sourceTexts: [
          'remind my volunteers about the shift',
          JSON.stringify({
            note: 'please bring water and comfortable shoes to the volunteer shift on saturday',
          }),
        ],
      },
      expected: { blocked: false, rule: null },
    },
    {
      id: 'copied-name-from-assistant',
      input: {
        draft: draft({
          question: 'Did the landlord form go out?',
          condition:
            'The assistant said it emailed Harlan Odegaard at the permit office about the landlord form, but it cannot send email.',
          handledWhen:
            'The reply says it cannot send email and offers a draft instead.',
        }),
        denylist: [],
        sourceTexts: [
          'did the landlord form go out?',
          'Done. I emailed Harlan Odegaard at the permit office about the landlord form this morning.',
        ],
      },
      expected: { blocked: true, rule: 'copiedText' },
    },
    {
      id: 'denylisted-term',
      input: {
        draft: draft({
          question: 'How do I get on the ballot in Lakemoor?',
          condition: 'The user asks about ballot access in their own town.',
          handledWhen: 'The reply names the office that handles ballot access.',
        }),
        denylist: ['Lakemoor'],
        sourceTexts: ['how do I get on the ballot in my town'],
      },
      expected: { blocked: true, rule: 'denylist' },
    },
    {
      id: 'denylisted-term-in-case-id',
      input: {
        draft: draft({
          caseId: 'maple-falls-ward-2-turnout',
          question: 'What turnout should I expect in my ward this fall?',
          condition: 'The user asks for a turnout number for their ward.',
          handledWhen:
            'The reply gives a range and says where the number comes from.',
        }),
        denylist: ['Maple Falls'],
        sourceTexts: ['what turnout should I expect in my ward'],
      },
      expected: { blocked: true, rule: 'denylist' },
    },
    {
      id: 'hyphenated-denylisted-term-in-case-id',
      input: {
        draft: draft({
          caseId: 'delacroix-venn-asks-about-turnout',
          question: 'What turnout should I expect in my ward this fall?',
          condition: 'The user asks for a turnout number for their ward.',
          handledWhen:
            'The reply gives a range and says where the number comes from.',
        }),
        denylist: ['Delacroix-Venn'],
        sourceTexts: ['what turnout should I expect in my ward'],
      },
      expected: { blocked: true, rule: 'denylist' },
    },
    {
      id: 'triangulation-only-pharmacist',
      input: {
        draft: draft({
          question:
            'I’m the only pharmacist on our five-seat council, in a town with one stoplight. How do I answer questions about the clinic closing?',
          condition:
            'The user asks how to respond to residents about a clinic closing.',
          handledWhen:
            'The reply drafts a response and states no figures it cannot source.',
        }),
        denylist: [],
        sourceTexts: ['how do I answer people about the clinic closing'],
      },
      expected: { blocked: true, rule: 'secondRead' },
    },
    {
      id: 'triangulation-recount-margin',
      input: {
        draft: draft({
          question:
            'I won my seat by 17 votes in the March 2025 special election. Is a recall petition with 212 signatures valid?',
          condition:
            'The user asks whether a recall petition has enough signatures.',
          handledWhen:
            'The reply says where the signature rule comes from and does not invent a threshold.',
        }),
        denylist: [],
        sourceTexts: ['is the recall petition against me valid'],
      },
      expected: { blocked: true, rule: 'secondRead' },
    },
    {
      id: 'needs-setup-own-name',
      input: {
        draft: {
          needsSetup:
            'An account like Avery Quillon’s, whose recount is still pending.',
        },
        denylist: ['Avery', 'Quillon'],
        sourceTexts: ['should I still get sworn in while the recount runs'],
      },
      expected: { blocked: true, rule: 'denylist' },
    },
    {
      id: 'needs-setup-third-party-name',
      input: {
        draft: {
          needsSetup:
            'Race data showing Garrick Pellow as the incumbent opponent.',
        },
        denylist: [],
        sourceTexts: ['what is my opponent’s record on taxes'],
      },
      expected: { blocked: true, rule: 'secondRead' },
    },
  ],
})
