import { describe, expect, it, vi } from 'vitest'
import { FILTER_DIMENSION_PROVENANCE_RULES } from '@/contacts/filterDimensions.catalog'
import { PICKED_NEXT_STEPS_LEAD } from '@goodparty_org/contracts'
import {
  appEnvOverrides,
  useAppEnvOverrides,
} from '@/shared/test-utils/appEnvOverrides'
import {
  buildChiefOfStaffSystemPrompt,
  COS_GUARDRAIL_DECLINE,
} from './chiefOfStaffPrompt'
import { guardrailLine } from '../../services/guardrailLines'
import { HONEST_REPORTING_BLOCK } from '../../services/assistantRules.prompt'
import { ChiefOfStaffContext } from './chiefOfStaffContext.service'
import type { Organization } from '../../../../generated/prisma'

// The segmentation method is held to non-prod deploys, so the suite drives
// that gate directly rather than depending on the runner's environment.
useAppEnvOverrides({ IS_NON_PROD_DEPLOY: true })

const baseCtx = (
  overrides: Partial<ChiefOfStaffContext> = {},
): ChiefOfStaffContext => ({
  conversationId: 'conv-1',
  electedOfficeId: 'office-1',
  organizationSlug: 'org-1',
  organization: { slug: 'org-1' } as Organization,
  userFirstName: 'Jordan',
  userLastName: 'Lee',
  officeTitle: 'City Council Member',
  jurisdiction: null,
  swornInDate: null,
  party: null,
  electedDate: null,
  termStartDate: null,
  termEndDate: null,
  priorities: [],
  isFirstConversation: false,
  anchor: null,
  districtFilters: null,
  constituentToolEnabled: false,
  peopleDataset: { base: 'voters' },
  ...overrides,
})

const TOOLS = [
  'crud_priorities',
  'web_search',
  'list_briefings',
  'get_briefing',
]

// Every tool ChiefOfStaffHandler can register, so a test that cares about
// block ordering sees every conditional rule block at once.
const ALL_TOOLS = [
  ...TOOLS,
  'query_constituent_data',
  'describe_constituent_data',
  'read_community_issues',
  'describe_filter_dimensions',
  'count_contacts',
  'crud_saved_filters',
]

describe('buildChiefOfStaffSystemPrompt', () => {
  describe('reporting back, behind serve-citizen-panels', () => {
    const send = {
      outreachId: 77,
      priorityId: 'pri-1',
      priorityTitle: 'Downtown parking',
      sentOn: '2026-10-05',
      audience: 'Everyone you texted about Downtown parking on October 5',
      reached: 240,
      canReach: 236,
      answered: 31,
      themes: [],
      reportBack: null,
    }

    it('knows a report back is due and points into the priority', () => {
      const prompt = buildChiefOfStaffSystemPrompt({
        ctx: baseCtx({ reportBacks: [send] }),
        toolNames: TOOLS,
      })
      expect(prompt).toContain(
        'Priority pri-1 (Downtown parking), outreach 77: 240 texted on 2026-10-05, 31 answered. Not reported back yet.',
      )
    })

    it('knows a report back already went out', () => {
      const prompt = buildChiefOfStaffSystemPrompt({
        ctx: baseCtx({
          reportBacks: [
            { ...send, reportBack: { outreachId: 90, sentOn: '2026-10-12' } },
          ],
        }),
        toolNames: TOOLS,
      })
      expect(prompt).toContain('Reported back 2026-10-12.')
    })

    it('says nothing about reporting back with the flag off', () => {
      const prompt = buildChiefOfStaffSystemPrompt({
        ctx: baseCtx(),
        toolNames: TOOLS,
      })
      expect(prompt).not.toContain('REPORTING BACK')
      expect(prompt).not.toContain('<report_backs>')
    })
  })

  describe("a priority's results before a good read, behind serve-citizen-panels", () => {
    const priority = {
      id: 'pri-1',
      title: 'Downtown parking',
      description: 'Not enough spaces near Main.',
      archivedAt: null,
    }

    it('knows where each priority read stands and holds results back', () => {
      const prompt = buildChiefOfStaffSystemPrompt({
        ctx: baseCtx({
          priorities: [priority],
          priorityReads: new Map([
            [
              'pri-1',
              {
                answers: 54,
                needed: 96,
                groupsHeard: 9,
                groupsTotal: 12,
                good: false,
                status: 'gettingClose',
                underrepresented: ['age65plus', 'unreachedAreas'],
              },
            ],
          ]),
        }),
        toolNames: TOOLS,
      })
      expect(prompt).toContain(
        '- Downtown parking, groups heard from: 9 of 12, status: Still unsure what some groups think, hear more from: people 65 and over and people in a few neighborhoods, good read: no: Not enough spaces near Main.',
      )
      expect(prompt).toContain("A PRIORITY'S RESULTS BEFORE A GOOD READ")
    })

    it('says nothing about a good read with the flag off', () => {
      const prompt = buildChiefOfStaffSystemPrompt({
        ctx: baseCtx({ priorities: [priority] }),
        toolNames: TOOLS,
      })
      expect(prompt).not.toContain('groups heard from')
      expect(prompt).not.toContain('BEFORE A GOOD READ')
    })
  })

  it('names the official and their office, and declines with its own line', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: TOOLS,
    })
    expect(prompt).toContain(COS_GUARDRAIL_DECLINE)
    expect(prompt).toContain('City Council Member')
    expect(prompt).toContain('Jordan Lee')
  })

  const priorityInFlow = {
    id: 'pri-1',
    title: 'Rents near transit',
    description: 'Keep renters near the new line.',
    archivedAt: null,
    flow: {
      currentStep: 'evidence' as const,
      nextAction: 'Pull the rent numbers',
      checks: [
        {
          stepId: 'define' as const,
          check: {
            state: 'deferred' as const,
            who: 'Renters on Oak',
            question: 'Is rent what is pushing you out?',
            when: 'after the budget hearing',
            raised: 1,
            contrast: {
              state: 'deferred' as const,
              who: 'Owners across town',
              question: 'Would you pay toward this?',
            },
          },
        },
      ],
    },
  }

  it('carries what constituents said on a check they answered', () => {
    const answered = {
      ...priorityInFlow,
      flow: {
        ...priorityInFlow.flow,
        checks: [
          {
            stepId: 'define' as const,
            check: {
              state: 'confirmed' as const,
              who: 'Renters on Oak',
              question: '',
              raised: 0,
              heard: 'Rent, mostly, said three households',
              contrast: {
                state: 'revised' as const,
                who: '',
                question: '',
                heard: 'Owners want the cost shared',
              },
            },
          },
        ],
      },
    }
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx({ priorities: [answered] }),
      toolNames: TOOLS,
    })
    expect(prompt).toContain(
      'constituents said: Rent, mostly, said three households',
    )
    expect(prompt).toContain('constituents said: Owners want the cost shared')
  })

  it('carries where each priority stands and points into its flow', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx({ priorities: [priorityInFlow] }),
      toolNames: TOOLS,
    })
    expect(prompt).toContain(
      '- Rents near transit (id: pri-1) on: What we know, next: Pull the ' +
        'rent numbers, constituent checks: The problem: put off, who: ' +
        'Renters on Oak, asking: Is rent what is pushing you out?, timing: ' +
        'after the budget hearing, raised 1 of 3 times, least ' +
        'affected: put off (Owners across town, asking: Would you pay ' +
        'toward this?): Keep renters near the new line.',
    )
    expect(prompt).not.toContain('CHECKS THEY PUT OFF')
  })

  it('says when a clarify question takes several answers', () => {
    const withClarify = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: [...TOOLS, 'ask_clarify_question'],
    })
    expect(withClarify).toContain('multiSelect')
    expect(
      buildChiefOfStaffSystemPrompt({ ctx: baseCtx(), toolNames: TOOLS }),
    ).not.toContain('multiSelect')
  })

  it('offers several outreach pieces as one multi-select question', () => {
    const rule = 'never list them in prose'
    const both = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: [
        ...TOOLS,
        'ask_clarify_question',
        'present_outreach_proposal',
      ],
    })
    expect(both).toContain(rule)
    expect(
      buildChiefOfStaffSystemPrompt({
        ctx: baseCtx(),
        toolNames: [...TOOLS, 'present_outreach_proposal'],
      }),
    ).not.toContain(rule)
  })

  it('checks in on a put-off check only with the reminder tool', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx({ priorities: [priorityInFlow] }),
      toolNames: [...TOOLS, 'record_check_reminder'],
    })
    expect(prompt).toContain('CHECKS THEY PUT OFF')
  })

  it('says a priority with no checks has none yet', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx({
        priorities: [
          {
            ...priorityInFlow,
            flow: { currentStep: 'define', nextAction: null, checks: [] },
          },
        ],
      }),
      toolNames: TOOLS,
    })
    expect(prompt).toContain(
      'on: The problem, next: nothing scheduled, constituent checks: none yet',
    )
  })

  it('asks for priorities when none are on file', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx({ priorities: [] }),
      toolNames: TOOLS,
    })
    expect(prompt).toContain('None on file yet.')
    expect(prompt).toContain('PRIORITIES NOT ON FILE')
  })

  // Independent of whether this is their first conversation: a returning
  // holder who never set priorities still needs to be asked.
  it('asks a returning user for priorities they never set', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx({ isFirstConversation: false, priorities: [] }),
      toolNames: TOOLS,
    })
    expect(prompt).toContain('PRIORITIES NOT ON FILE')
  })

  it('drops the priorities ask once they have some on file', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx({
        priorities: [
          {
            id: 'p1',
            title: 'Affordable housing',
            description: 'Three projects this term.',
            archivedAt: null,
          },
        ],
      }),
      toolNames: TOOLS,
    })
    expect(prompt).not.toContain('PRIORITIES NOT ON FILE')
  })

  it('introduces itself on the first conversation only', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx({ isFirstConversation: true }),
      toolNames: TOOLS,
    })
    expect(prompt).toContain('INTRODUCTION (this is their first conversation)')
  })

  // A new conversation per session means a returning holder arrives with an
  // empty transcript, so without this the model re-introduces itself forever.
  it('forbids reintroducing itself on a returning conversation', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx({ isFirstConversation: false }),
      toolNames: TOOLS,
    })
    expect(prompt).toContain('INTRODUCTION (you have worked together before)')
    expect(prompt).not.toContain('INTRODUCTION (this is their first conversation)')
  })

  it('recognizes the lead the app puts on picked next steps', () => {
    for (const isFirstConversation of [true, false]) {
      const prompt = buildChiefOfStaffSystemPrompt({
        ctx: baseCtx({ isFirstConversation }),
        toolNames: TOOLS,
      })
      expect(prompt).toContain(PICKED_NEXT_STEPS_LEAD)
    }
  })

  it('lists active priorities in the prompt', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx({
        priorities: [
          {
            id: 'p1',
            title: 'Affordable housing',
            description: 'Three projects this term.',
            archivedAt: null,
          },
        ],
      }),
      toolNames: TOOLS,
    })
    expect(prompt).toContain('Affordable housing')
    expect(prompt).toContain('Three projects this term.')
  })

  it('only includes tool-specific rule blocks for available tools', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: ['crud_priorities'],
    })
    expect(prompt).toContain('PRIORITIES RULES')
    expect(prompt).not.toContain('WEB SEARCH RULES')
    expect(prompt).not.toContain('CONSTITUENT DATA RULES')
  })

  it('drops the clarify rules when the tool is not registered', () => {
    const withClarify = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: [...TOOLS, 'ask_clarify_question'],
    })
    expect(withClarify).toContain('any rewording of it')
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: TOOLS,
    })
    expect(prompt).not.toContain('any rewording of it')
  })

  it('includes constituent-data rules when the constituent tool is available', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: ['query_constituent_data', 'describe_constituent_data'],
    })
    expect(prompt).toContain('CONSTITUENT DATA RULES')
  })

  it('imports the provenance rules when count_contacts is registered', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: ['count_contacts', 'describe_filter_dimensions'],
    })
    expect(prompt).toContain('CONTACT LIST RULES')
    expect(prompt).toContain(FILTER_DIMENSION_PROVENANCE_RULES)
  })

  it('gates the applied-filter disclosure on count_contacts', () => {
    const withCount = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: ['describe_filter_dimensions', 'count_contacts'],
    })
    expect(withCount).toContain(
      'name any part of the request the filter could not apply',
    )
    expect(withCount).not.toContain('abbreviating it does not make it belong')
  })

  it('gates the naming and card-created rules on crud_saved_filters', () => {
    const withSaved = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: ['crud_saved_filters'],
    })
    expect(withSaved).toContain('abbreviating it does not make it belong')
    expect(withSaved).not.toContain(
      'name any part of the request the filter could not apply',
    )
  })

  it('omits the provenance rules when the CRM tools are not registered', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: TOOLS,
    })
    expect(prompt).not.toContain('CONTACT LIST RULES')
    expect(prompt).not.toContain(FILTER_DIMENSION_PROVENANCE_RULES)
  })

  it('teaches the segmentation method once saving is available', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: [
        'describe_filter_dimensions',
        'count_contacts',
        'crud_saved_filters',
      ],
    })
    expect(prompt).toContain('BUILDING A SEGMENT')
  })

  // The release train promotes every merge to prod unattended, so this gate is
  // the only thing keeping an unfinished method away from real officials.
  it('withholds the method on a prod deploy even with the tool registered', () => {
    appEnvOverrides.IS_NON_PROD_DEPLOY = false
    try {
      const prompt = buildChiefOfStaffSystemPrompt({
        ctx: baseCtx(),
        toolNames: ALL_TOOLS,
      })
      expect(prompt).not.toContain('BUILDING A SEGMENT')
      // The rest of the saved-list surface is unaffected by the gate.
      expect(prompt).toContain('SAVED LIST RULES')
    } finally {
      appEnvOverrides.IS_NON_PROD_DEPLOY = true
    }
  })

  it('withholds the method from a session that can only count', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: ['describe_filter_dimensions', 'count_contacts'],
    })
    expect(prompt).not.toContain('BUILDING A SEGMENT')
  })

  it('teaches the map rules once show_list_map is registered', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: [...ALL_TOOLS, 'show_list_map'],
    })
    expect(prompt).toContain('LIST MAP RULES')
    expect(prompt).toContain('DRAWN AREA RULES')
  })

  it('omits the map rules when the tool is not registered', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: ALL_TOOLS,
    })
    expect(prompt).not.toContain('LIST MAP RULES')
  })

  it('sizes the unknown group against the voter file on the voters dataset', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: ['query_constituent_data', 'describe_constituent_data'],
    })
    expect(prompt).toContain('a fifth to a third of the file')
    expect(prompt).not.toContain('not registered to vote')
  })

  it('blames missing scores on non-registration on the constituents dataset', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx({ peopleDataset: { base: 'constituents' } }),
      toolNames: ['query_constituent_data', 'describe_constituent_data'],
    })
    expect(prompt).not.toContain('of the file')
    expect(prompt).toContain(
      'residents who are not registered to vote are never scored',
    )
  })

  // A model that says it hit an authentication error it never hit is not a
  // capability problem, it is a reporting one, so these rules are unconditional
  // rather than hung off any one tool.
  // The dimension is `modes: 'win'` in the catalog and 400s for an `eo-` org
  // at the routes, so the tool path cannot express it for Serve. This is for
  // the turn where the user asks for it by name, and for the proxy the model
  // would otherwise reach for.
  it('refuses to segment constituents by ethnicity', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: ['count_contacts', 'describe_filter_dimensions'],
    })
    expect(prompt).toContain('Never segment constituents by ethnicity')
  })

  // Two rules, deliberately scoped differently. Cutting a list is a tool
  // capability, so that rule rides with the CRM tools. Refusing to plan around
  // who to hear from by ethnicity is a policy boundary that does not depend on
  // which tools happen to be registered, so it sits with the guardrails.
  it('carries the list-cutting rule only where the CRM tools are registered', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: ['crud_priorities'],
    })
    expect(prompt).not.toContain('Never segment constituents by ethnicity')
  })

  it('refuses exclusionary planning by ethnicity whatever the tools', () => {
    for (const toolNames of [[], ['crud_priorities'], ['count_contacts']]) {
      const prompt = buildChiefOfStaffSystemPrompt({
        ctx: baseCtx(),
        toolNames,
      })
      expect(prompt).toContain(
        'Never help decide who to consult, hear from, reach, or skip on the basis of ethnicity',
      )
    }
  })

  it('always includes the honest reporting rules', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: [],
    })
    expect(prompt).toContain(HONEST_REPORTING_BLOCK)
  })

  it('always includes the caution rules with both registry lines', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: [],
    })
    expect(prompt).toContain(guardrailLine('legal_advice', 'chief_of_staff'))
    expect(prompt).toContain(
      guardrailLine('professional_advice', 'chief_of_staff'),
    )
  })

  it('asks for the handoff line only where compose_handoff is registered', () => {
    const line = guardrailLine('handoff_draft', 'chief_of_staff')
    expect(
      buildChiefOfStaffSystemPrompt({
        ctx: baseCtx(),
        toolNames: ['compose_handoff'],
      }),
    ).toContain(line)
    expect(
      buildChiefOfStaffSystemPrompt({ ctx: baseCtx(), toolNames: [] }),
    ).not.toContain(line)
  })

  it('asks for the small-count line only where the data tool is registered', () => {
    const line = guardrailLine('small_count', 'chief_of_staff')
    expect(
      buildChiefOfStaffSystemPrompt({
        ctx: baseCtx(),
        toolNames: ['query_constituent_data', 'describe_constituent_data'],
      }),
    ).toContain(line)
    expect(
      buildChiefOfStaffSystemPrompt({ ctx: baseCtx(), toolNames: [] }),
    ).not.toContain(line)
  })

  it("carries the product map without Win's Pro status", () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: TOOLS,
    })
    expect(prompt).toContain('<product_map>')
    // Serve passes no Pro flag, so its map carries no status line and its
    // rules carry no rule that reads one.
    expect(prompt).not.toContain('Pro status:')
    expect(prompt).not.toContain('Access note says it needs Pro')
  })

  it('pins the campaign-resource boundary', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: TOOLS,
    })
    expect(prompt).toContain('GoodParty has a separate campaign platform')
  })

  it("tells the chief of staff what day it is, in the office state's zone", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T12:00:00.000Z'))
    try {
      const prompt = buildChiefOfStaffSystemPrompt({
        ctx: baseCtx({ state: 'CA' }),
        toolNames: TOOLS,
      })
      expect(prompt).toContain(
        'Today is Monday, October 5, 2026 (Pacific Time).',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('surfaces party and term dates in the office context', () => {
    // Pinned: an unpinned clock inverts this to "this term has ended" once
    // the 2028 end date passes.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'))
    try {
      const prompt = buildChiefOfStaffSystemPrompt({
        ctx: baseCtx({
          party: 'Independent',
          electedDate: new Date('2024-11-05T00:00:00.000Z'),
          termStartDate: new Date('2024-12-03T00:00:00.000Z'),
          termEndDate: new Date('2028-12-05T00:00:00.000Z'),
        }),
        toolNames: TOOLS,
      })
      expect(prompt).toContain('Party: Independent')
      expect(prompt).toContain('Last elected: 2024-11-05')
      expect(prompt).toContain(
        'Current term: 2024-12-03 to 2028-12-05 (about 27 month(s) remaining)',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('computes time in office from a non-null swornInDate', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'))
    try {
      const prompt = buildChiefOfStaffSystemPrompt({
        ctx: baseCtx({ swornInDate: new Date('2025-03-01T00:00:00.000Z') }),
        toolNames: TOOLS,
      })
      // 2025-03-01 to 2026-09-01 is 18 calendar months. The sworn-in date is
      // a @db.Date at UTC midnight, so a local-zone read west of UTC would
      // see 2025-02-28 and count 19.
      expect(prompt).toContain('Time in office: ~18 month(s) since sworn in')
    } finally {
      vi.useRealTimers()
    }
  })

  // A @db.Date is UTC midnight; formatting it through a zone west of UTC would
  // print the previous day.
  it('formats term dates off the ISO date half, not the local zone', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx({
        termStartDate: new Date('2024-01-01T00:00:00.000Z'),
        termEndDate: new Date('2028-01-01T00:00:00.000Z'),
      }),
      toolNames: TOOLS,
    })
    expect(prompt).toContain('Current term: 2024-01-01 to 2028-01-01')
    expect(prompt).not.toContain('2023-12-31')
    expect(prompt).not.toContain('2027-12-31')
  })

  // differenceInCalendarMonths ignores day-of-month, so an end date that has
  // already passed inside the current month differences to 0 and used to read
  // as time remaining on a term that is over.
  it('ends a term that lapsed earlier in the current month', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T12:00:00.000Z'))
    try {
      const prompt = buildChiefOfStaffSystemPrompt({
        ctx: baseCtx({
          termStartDate: new Date('2022-09-05T00:00:00.000Z'),
          termEndDate: new Date('2026-09-05T00:00:00.000Z'),
        }),
        toolNames: TOOLS,
      })
      expect(prompt).toContain('this term has ended')
      expect(prompt).not.toContain('month(s) remaining')
    } finally {
      vi.useRealTimers()
    }
  })

  // 9pm in California is already tomorrow in UTC. The term counts have to
  // start from the same local day the today line names, or a term ending
  // tomorrow reads as over while the prompt says it is still today.
  it("counts the term from the office's own day, not the server's", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-15T04:00:00.000Z'))
    try {
      const prompt = buildChiefOfStaffSystemPrompt({
        ctx: baseCtx({
          state: 'CA',
          termStartDate: new Date('2022-09-15T00:00:00.000Z'),
          termEndDate: new Date('2026-09-15T00:00:00.000Z'),
        }),
        toolNames: TOOLS,
      })
      expect(prompt).toContain(
        'Today is Monday, September 14, 2026 (Pacific Time).',
      )
      expect(prompt).not.toContain('this term has ended')
    } finally {
      vi.useRealTimers()
    }
  })

  // Terms are half-open [start, end), so the seat is not held on the end date
  // itself. Same boundary deriveIsActive / isHeldOffice use for a past office.
  it('treats a term ending today as already ended', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T12:00:00.000Z'))
    try {
      const prompt = buildChiefOfStaffSystemPrompt({
        ctx: baseCtx({
          termStartDate: new Date('2022-09-14T00:00:00.000Z'),
          termEndDate: new Date('2026-09-14T00:00:00.000Z'),
        }),
        toolNames: TOOLS,
      })
      expect(prompt).toContain('this term has ended')
      expect(prompt).not.toContain('month(s) remaining')
    } finally {
      vi.useRealTimers()
    }
  })

  it('counts a term ending later this month as still running', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T12:00:00.000Z'))
    try {
      const prompt = buildChiefOfStaffSystemPrompt({
        ctx: baseCtx({
          termStartDate: new Date('2022-09-25T00:00:00.000Z'),
          termEndDate: new Date('2026-09-25T00:00:00.000Z'),
        }),
        toolNames: TOOLS,
      })
      expect(prompt).toContain('about 0 month(s) remaining')
    } finally {
      vi.useRealTimers()
    }
  })

  // Same boundary on the other end: elected but not yet sworn in.
  it('reports time in office as unknown before the swearing in', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T12:00:00.000Z'))
    try {
      const prompt = buildChiefOfStaffSystemPrompt({
        ctx: baseCtx({ swornInDate: new Date('2026-09-20T00:00:00.000Z') }),
        toolNames: TOOLS,
      })
      expect(prompt).toContain('Time in office: unknown')
      expect(prompt).not.toContain('month(s) since sworn in')
    } finally {
      vi.useRealTimers()
    }
  })

  // The countdown comes from the end date alone, so it stays correct with no
  // start on file. Say the start is missing instead of dropping the count.
  it('keeps the countdown but flags a missing term start', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T12:00:00.000Z'))
    try {
      const prompt = buildChiefOfStaffSystemPrompt({
        ctx: baseCtx({
          termStartDate: null,
          termEndDate: new Date('2028-12-05T00:00:00.000Z'),
        }),
        toolNames: TOOLS,
      })
      expect(prompt).toContain(
        'Current term: unknown to 2028-12-05 (about 27 month(s) remaining; ' +
          'start date not on file)',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not flag a missing start when both dates are on file', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T12:00:00.000Z'))
    try {
      const prompt = buildChiefOfStaffSystemPrompt({
        ctx: baseCtx({
          termStartDate: new Date('2024-12-03T00:00:00.000Z'),
          termEndDate: new Date('2028-12-05T00:00:00.000Z'),
        }),
        toolNames: TOOLS,
      })
      expect(prompt).not.toContain('start date not on file')
    } finally {
      vi.useRealTimers()
    }
  })

  it('says a finished term has ended rather than counting down', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx({
        termStartDate: new Date('2016-12-03T00:00:00.000Z'),
        termEndDate: new Date('2020-12-05T00:00:00.000Z'),
      }),
      toolNames: TOOLS,
    })
    expect(prompt).toContain('this term has ended')
  })

  it('marks missing office fields unknown instead of with a dash', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: TOOLS,
    })
    expect(prompt).toContain('Party: unknown')
    expect(prompt).toContain('Last elected: unknown')
    expect(prompt).toContain('Current term: unknown')
    expect(prompt).toContain('Time in office: unknown')
  })

  // Every tool rule block pulls toward more detail, so the block that holds a
  // reply short has to be the last thing read.
  it('closes with the voice, proactivity and mechanics rules', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: ALL_TOOLS,
    })
    expect(prompt).toContain('VOICE AND LENGTH')
    expect(prompt).toContain('PROACTIVITY')
    expect(prompt).toContain('WRITING MECHANICS')
    // Assert against blocks that are actually present under ALL_TOOLS: an
    // absent block indexes to -1 and any position would beat it.
    for (const earlier of [
      'OFFICE STRUCTURE',
      'BRIEFING RULES',
      'CONSTITUENT DATA RULES',
      'SAVED LIST RULES',
      'Instructions:',
    ]) {
      expect(prompt).toContain(earlier)
      expect(prompt.indexOf('VOICE AND LENGTH')).toBeGreaterThan(
        prompt.indexOf(earlier),
      )
    }
  })

  it('carries no em dashes', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: TOOLS,
    })
    expect(prompt).not.toContain('\u2014')
  })

  it('tells it to look up office structure only when it can search', () => {
    const withSearch = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: ['web_search'],
    })
    expect(withSearch).toContain('Look it up rather than asking')

    const withoutSearch = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx(),
      toolNames: [],
    })
    expect(withoutSearch).not.toContain('Look it up rather than asking')
    expect(withoutSearch).toContain(
      'ask them in one short question when it matters',
    )
  })

  it('omits the first-run research block on a returning conversation', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx({ isFirstConversation: false }),
      toolNames: ['web_search'],
    })
    expect(prompt).not.toContain('FIRST-RUN RESEARCH')
  })

  it('bootstraps from research on the first conversation', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx({ isFirstConversation: true }),
      toolNames: ['web_search', 'list_briefings'],
    })
    expect(prompt).toContain('FIRST-RUN RESEARCH')
    expect(prompt).toContain('Search for their office and jurisdiction')
  })

  it('never advertises search in the bootstrap when it has none', () => {
    const prompt = buildChiefOfStaffSystemPrompt({
      ctx: baseCtx({ isFirstConversation: true }),
      toolNames: ['list_briefings'],
    })
    expect(prompt).toContain('FIRST-RUN RESEARCH')
    expect(prompt).not.toContain('Search for their office and jurisdiction')
    expect(prompt).toContain('You have no web search this session')
  })
})
