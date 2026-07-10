import { z } from 'zod'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import {
  OrdinanceClarifyQuestionSchema,
  OrdinanceNextStepOfferSchema,
  OrdinanceSourceSchema,
} from '@goodparty_org/contracts'
import {
  ORDINANCE_READ_SECTIONS,
  OrdinanceFlowToolsService,
} from '../services/ordinanceFlowTools.service'

export interface OrdinanceToolDeps {
  service: OrdinanceFlowToolsService
  ordinanceId: string
  electedOfficeId: string
  step: string
}

const getCurrentCodeInput = z.object({
  chapter: z
    .string()
    .optional()
    .describe('Optional chapter/section label to read, e.g. "Chapter 9.16".'),
})

export const buildGetCurrentCodeTool = (
  deps: OrdinanceToolDeps,
): LlmStreamTool<typeof getCurrentCodeInput> => ({
  description:
    "Read the current municipal code for the official's municipality. Returns " +
    'chapter text plus a citation. May return a stub until the code loader is ' +
    'wired; treat a stubbed result as "not yet available".',
  inputSchema: getCurrentCodeInput,
  execute: ({ chapter }) =>
    deps.service.getCurrentCode(
      deps.ordinanceId,
      deps.electedOfficeId,
      chapter,
    ),
})

const readOrdinanceInput = z.object({
  section: z.enum(ORDINANCE_READ_SECTIONS),
})

export const buildReadOrdinanceTool = (
  deps: OrdinanceToolDeps,
): LlmStreamTool<typeof readOrdinanceInput> => ({
  description:
    'Read one section of the ordinance record you are working on: clarify, ' +
    'clarify_answers, authority, current_law, comparables, draft, research, ' +
    'or scratchpad. Use it to ground yourself in what prior steps produced.',
  inputSchema: readOrdinanceInput,
  execute: ({ section }) =>
    deps.service.readSection(deps.ordinanceId, deps.electedOfficeId, section),
})

const saveNoteInput = z.object({
  text: z.string().min(1).describe('A short, durable note to carry forward.'),
})

export const buildSaveNoteTool = (
  deps: OrdinanceToolDeps,
): LlmStreamTool<typeof saveNoteInput> => ({
  description:
    'Save a consequential thing the user said to the ordinance scratchpad so ' +
    'it reaches later steps and the draft. Use for durable intent, not chit-chat.',
  inputSchema: saveNoteInput,
  execute: ({ text }) =>
    deps.service.appendNote(
      deps.ordinanceId,
      deps.electedOfficeId,
      deps.step,
      text,
    ),
})

export const buildOfferNextStepTool = (): LlmStreamTool<
  typeof OrdinanceNextStepOfferSchema
> => ({
  description:
    "When this step's work is settled, call this to give the user a button to " +
    'move on to the next step. Provide a short button label naming what comes ' +
    "next (e.g. 'Check legal authority'). Call it once, after a brief closing " +
    'summary; do not just ask in prose whether to continue.',
  inputSchema: OrdinanceNextStepOfferSchema,
  execute: () => ({ offered: true }),
})

export const buildAskClarifyQuestionTool = (): LlmStreamTool<
  typeof OrdinanceClarifyQuestionSchema
> => ({
  description:
    'Ask the user ONE clarifying question at a time. Provide 2-4 suggested ' +
    'options; a factual option should cite a source, a pure-judgment option ' +
    'need not. The UI always adds an "Or write your own..." freeform option, ' +
    'so never add one yourself. Do not ask the next question until this one is ' +
    'answered. Call save_answer once the user responds.',
  inputSchema: OrdinanceClarifyQuestionSchema,
  execute: ({ questionId }) => ({ asked: true, questionId }),
})

const saveAnswerInput = z.object({
  questionId: z.string(),
  question: z.string(),
  answer: z.string(),
  source: OrdinanceSourceSchema.optional(),
})

export const buildSaveAnswerTool = (
  deps: OrdinanceToolDeps,
): LlmStreamTool<typeof saveAnswerInput> => ({
  description:
    "Record the user's answer to a clarify question. Call this after the user " +
    'responds (via a suggested option, a written-in option, or a typed reply), ' +
    'then ask the next question or conclude.',
  inputSchema: saveAnswerInput,
  execute: (input) =>
    deps.service.appendAnswer(deps.ordinanceId, deps.electedOfficeId, {
      questionId: input.questionId,
      question: input.question,
      answer: input.answer,
      ...(input.source && { source: input.source }),
    }),
})

const saveSynthesisInput = z.object({
  synthesis: z.string(),
})

export const buildSaveSynthesisTool = (
  deps: OrdinanceToolDeps,
): LlmStreamTool<typeof saveSynthesisInput> => ({
  description:
    'Persist a short synthesis of the clarify answers before moving on. Call ' +
    'this once the essentials are settled, right before offer_next_step, so ' +
    'later steps (which read the clarify section) see the synthesis.',
  inputSchema: saveSynthesisInput,
  execute: (input) =>
    deps.service.saveSynthesis(deps.ordinanceId, deps.electedOfficeId, {
      synthesis: input.synthesis,
    }),
})
