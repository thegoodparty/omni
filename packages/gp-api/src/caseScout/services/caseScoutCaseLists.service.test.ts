import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils'
import { CaseScoutCaseListsService } from './caseScoutCaseLists.service'

const SUITE = `cases: [
  { id: 'shared', grading: { condition: 'The suite wording.' } },
  { id: 'suite-only', grading: { condition: 'Only in the suite.' } },
  { id: 'ungraded', input: { turns: ['Hi'] } },
]`

const LIST = JSON.stringify({
  note: 'The fixture account.',
  cases: [
    { caseId: 'shared', condition: 'The old wording.' },
    { caseId: 'json-only', condition: 'Only in the JSON.' },
  ],
})

// Answers the suite and the JSON by URL; `false` makes that file a 404.
const stubMain = (files: { suite: string | false; list: string | false }) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const body = String(input).endsWith('.eval.ts') ? files.suite : files.list
    return body === false
      ? new Response('Not Found', { status: 404 })
      : new Response(body, { status: 200 })
  })

const caseLists = () => new CaseScoutCaseListsService(createMockLogger())

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CaseScoutCaseListsService.read', () => {
  it('merges the suite and the JSON, the suite wording first', async () => {
    const fetchSpy = stubMain({ suite: SUITE, list: LIST })
    const errors: string[] = []

    const list = await caseLists().read('campaign_assistant', errors)

    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual([
      'https://raw.githubusercontent.com/thegoodparty/omni/main/' +
        'packages/gp-api/src/chats/general/campaign-manager/' +
        'campaign_assistant.eval.ts',
      'https://raw.githubusercontent.com/thegoodparty/omni/main/' +
        'packages/gp-api/src/chats/evals/judge/cases/campaign_assistant.json',
    ])
    expect(list).toEqual({
      agentId: 'campaign_assistant',
      caseCount: 4,
      caseIds: new Set(['shared', 'suite-only', 'ungraded', 'json-only']),
      conditions: [
        { caseId: 'shared', condition: 'The suite wording.' },
        { caseId: 'suite-only', condition: 'Only in the suite.' },
        { caseId: 'json-only', condition: 'Only in the JSON.' },
      ],
      fixtureDescription: 'The fixture account.',
    })
    expect(errors).toEqual([])
  })

  it('reads only the JSON for an agent with no suite', async () => {
    const fetchSpy = stubMain({ suite: SUITE, list: LIST })

    const list = await caseLists().read('ordinance_flow')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(list.caseIds).toEqual(new Set(['shared', 'json-only']))
  })

  it('falls back to the JSON when the suite fails', async () => {
    stubMain({ suite: false, list: LIST })
    const errors: string[] = []

    const list = await caseLists().read('chief_of_staff', errors)

    expect(list.caseIds).toEqual(new Set(['shared', 'json-only']))
    expect(list.conditions).toEqual([
      { caseId: 'shared', condition: 'The old wording.' },
      { caseId: 'json-only', condition: 'Only in the JSON.' },
    ])
    expect(list.fixtureDescription).toBe('The fixture account.')
    expect(errors).toEqual(['suite chief_of_staff could not be read'])
  })

  it('reads the suite alone when the JSON fails', async () => {
    stubMain({ suite: SUITE, list: false })
    const errors: string[] = []

    const list = await caseLists().read('chief_of_staff', errors)

    expect(list.caseCount).toBe(3)
    expect(list.conditions).toEqual([
      { caseId: 'shared', condition: 'The suite wording.' },
      { caseId: 'suite-only', condition: 'Only in the suite.' },
    ])
    expect(list.fixtureDescription).toBe('')
    expect(errors).toEqual(['case list chief_of_staff.json could not be read'])
  })

  it('records suite conditions it could not read', async () => {
    stubMain({
      suite: "{ id: 'shared', grading: { condition: SHARED } }",
      list: LIST,
    })
    const errors: string[] = []

    const list = await caseLists().read('chief_of_staff', errors)

    expect(list.conditions).toContainEqual({
      caseId: 'shared',
      condition: 'The old wording.',
    })
    expect(errors).toEqual([
      '1 suite conditions in chief_of_staff could not be read',
    ])
  })

  it('throws when neither source can be read', async () => {
    stubMain({ suite: 'no cases here', list: false })
    const errors: string[] = []

    await expect(caseLists().read('chief_of_staff', errors)).rejects.toThrow(
      'no case list for chief_of_staff could be read',
    )
    expect(errors).toEqual([
      'suite chief_of_staff had no readable cases',
      'case list chief_of_staff.json could not be read',
    ])
  })

  it('keeps readOrEmpty returning an empty list on a total miss', async () => {
    stubMain({ suite: false, list: false })
    const errors: string[] = []

    const list = await caseLists().readOrEmpty('chief_of_staff', errors)

    expect(list.caseCount).toBe(0)
    expect(errors).toEqual([
      'suite chief_of_staff could not be read',
      'case list chief_of_staff.json could not be read',
      'case list chief_of_staff could not be read',
    ])
  })
})
