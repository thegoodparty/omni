import { describe, expect, it } from 'vitest'
import { CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER } from '@/chats/services/chatStream.service'
import { toolBudgetExhaustedNote } from '@/llm/services/llm.service'
import { CiContextSchema } from '../record'
import {
  TOOL_BUDGET_FALLBACK_REPLY,
  ciContextFromEnv,
  classifyChatStatus,
} from './chat'

const env = (vars: Record<string, string>): NodeJS.ProcessEnv => vars

describe('TOOL_BUDGET_FALLBACK_REPLY', () => {
  it('is still the reply the tool-budget note instructs', () => {
    // The runner reads this reply as `blocked`. If the note is reworded and
    // this copy is not, a turn that ran out of tool budget silently reads as
    // a produced answer instead.
    expect(String(toolBudgetExhaustedNote.content)).toContain(
      TOOL_BUDGET_FALLBACK_REPLY,
    )
  })
})

describe('classifyChatStatus', () => {
  it('reads an ordinary answer as an agent result', () => {
    expect(classifyChatStatus('Three priorities.', false, [])).toBe('produced')
  })

  it('reads a stream error as infrastructure, never as a result', () => {
    expect(classifyChatStatus('partial text', true, [])).toBe('infraError')
  })

  it('reads a missing assistant turn as infrastructure', () => {
    expect(classifyChatStatus(null, false, [])).toBe('infraError')
  })

  it('reads the interrupted sentinel as infrastructure', () => {
    expect(
      classifyChatStatus(CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER, false, []),
    ).toBe('infraError')
  })

  it('reads an empty answer as infrastructure', () => {
    expect(classifyChatStatus('   \n ', false, [])).toBe('infraError')
  })

  it('reads the tool-budget fallback as blocked, keeping its output', () => {
    expect(
      classifyChatStatus(TOOL_BUDGET_FALLBACK_REPLY, false, [
        TOOL_BUDGET_FALLBACK_REPLY,
      ]),
    ).toBe('blocked')
  })

  it('reads a case-declared refusal as blocked', () => {
    const declined = 'I cannot break constituents down by political party.'
    expect(classifyChatStatus(`Sure. ${declined}`, false, [declined])).toBe(
      'blocked',
    )
  })

  it('does not read an unlisted refusal as blocked', () => {
    expect(
      classifyChatStatus('I would rather not answer that.', false, [
        TOOL_BUDGET_FALLBACK_REPLY,
      ]),
    ).toBe('produced')
  })
})

describe('ciContextFromEnv', () => {
  it('is absent on a local run', () => {
    expect(ciContextFromEnv(env({}))).toBeUndefined()
  })

  it('is absent when the run identifiers are incomplete', () => {
    expect(
      ciContextFromEnv(env({ GITHUB_REPOSITORY: 'thegoodparty/omni' })),
    ).toBeUndefined()
  })

  it('takes the PR number from the merge ref', () => {
    const ci = ciContextFromEnv(
      env({
        GITHUB_REPOSITORY: 'thegoodparty/omni',
        GITHUB_RUN_ID: '36592029654',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_REF: 'refs/pull/2198/merge',
      }),
    )

    expect(CiContextSchema.parse(ci)).toEqual({
      repo: 'thegoodparty/omni',
      prNumber: 2198,
      workflowRunId: '36592029654',
      workflowRunAttempt: 1,
      workflowRunUrl:
        'https://github.com/thegoodparty/omni/actions/runs/36592029654',
    })
  })

  it('falls back to PR_NUMBER when the ref is not a pull ref', () => {
    const ci = ciContextFromEnv(
      env({
        GITHUB_REPOSITORY: 'thegoodparty/omni',
        GITHUB_RUN_ID: '1',
        GITHUB_REF: 'refs/heads/universal-judge',
        PR_NUMBER: '2198',
      }),
    )
    expect(ci?.prNumber).toBe(2198)
  })

  it('carries no PR number for a sweep dispatched without one', () => {
    const ci = ciContextFromEnv(
      env({
        GITHUB_REPOSITORY: 'thegoodparty/omni',
        GITHUB_RUN_ID: '1',
        GITHUB_REF: 'refs/heads/universal-judge',
      }),
    )
    expect(ci?.prNumber).toBeUndefined()
    expect(CiContextSchema.safeParse(ci).success).toBe(true)
  })

  it('points a re-run at the attempt that produced it', () => {
    const ci = ciContextFromEnv(
      env({
        GITHUB_REPOSITORY: 'thegoodparty/omni',
        GITHUB_RUN_ID: '7',
        GITHUB_RUN_ATTEMPT: '3',
      }),
    )
    expect(ci?.workflowRunAttempt).toBe(3)
    expect(ci?.workflowRunUrl).toBe(
      'https://github.com/thegoodparty/omni/actions/runs/7/attempts/3',
    )
  })
})
