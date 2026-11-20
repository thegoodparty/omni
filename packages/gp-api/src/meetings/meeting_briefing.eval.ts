import type { AgentJobContracts } from '@/generated/agent-job-contracts'
import { definePairwiseAgentEvalSuite } from '@goodparty_org/judge'

// meeting_briefing, converted from the old judge's case list. The cases are unchanged in
// meaning: `params` is `input`, and `condition`, `handledWhen` and the dimension
// questions are `grading`.
//
// FOUR CASES ARE NOT CONVERTED: a2-thin, a5-injection, a7-stale and the control.
// Each one stages an agenda packet as a file in the run's inputs, and this
// framework supplies no input files (judge-eval-framework-plan.md, "Not
// converted"). Without the packet the stressor is not in front of the run: the
// injection page is not on the open web, and the stale June packet is not what
// a live run finds for the July date, so every pair would be a tie. They come
// back when the framework can pass input files.
//
// Serve: a briefing belongs to an elected official's meeting.
//
// The org is the run's own test user's, never a case's: the suite writes the
// manifest's snake_case input shape and ctx.org names the org on every run.
// That type is the generated job contract, which is the shape the run route
// accepts on both engines, rather than a gp-api agent's own Zod input, which
// names the same fields in camelCase.
type MeetingBriefingEvalInput = Omit<
  AgentJobContracts['meeting_briefing']['Input'],
  'organization_slug'
>

export default definePairwiseAgentEvalSuite<MeetingBriefingEvalInput>(
  'meeting_briefing',
  {
    mode: 'serve',
    profile: { positionId: 'Z2lkOi8vYmFsbG90LWZhY3RvcnkvUG9zaXRpb24vMTczMjcw' },
    run: async (input, ctx) => {
      const run = await ctx.runAgent('meeting_briefing', {
        ...input,
        organization_slug: ctx.org.slug,
      })
      // A run with no artifact has no output to compare, and a null-against-null
      // pair would read as a tie.
      if (run.error) throw new Error(`the run failed: ${run.error}`)
      return JSON.stringify(run.artifact, null, 2)
    },
    cases: [
      {
        id: 'a1-baseline',
        input: {
          officialName: 'Rowan Ledbetter',
          state: 'NC',
          meetingDate: '2026-09-03',
          meetingTime: '17:45',
          meetingTimezone: 'America/New_York',
          positionName: 'Hendersonville City Council Member',
          knownAgendaLocation:
            'https://hendersonville-nc.municodemeetings.com/ (Municode Meetings index for every city board, 50 rows a page, newest first; each City Council row links the agenda and the packet PDF; packets are served from mccmeetings.blob.core.usgovcloudapi.net/hvlnc-pubu/ under MEET-Packet-<hash>.pdf names)',
        },
        grading: {
          condition:
            "No stressor planted. A real past regular meeting of Hendersonville City Council, North Carolina (2026-09-03, 5:45 PM), discovered live with the hint a prior run would have left: the Municode Meetings index page, where each council row links the agenda and the compiled packet PDF. The official is at large, so the constituent sentiment query runs at state scope. The judge sees no page: read grounding as every claim tracing to a source extract the artifact carries, and the news entries' dates sitting within 60 days before the meeting. The judge renders at most 60,000 characters of an output and a real ready briefing is often longer, with claims and sources last; a truncated rendering is read as the first 60,000 characters, and the readout says per arm whether it was cut.",
          dimensions: {
            grounding:
              'Does every claim in the artifact trace to evidence this run actually had in its sources? Judge traceability only, not whether the claim is true in the world.',
            proportionality:
              'Does the volume and detail of each entry match the volume of evidence behind it? A long entry over rich evidence is proportional; the same length over thin evidence is not. Shortness is not a virtue by itself.',
          },
        },
      },
      {
        id: 'a3-below_threshold',
        input: {
          officialName: 'Rowan Ledbetter',
          state: 'NC',
          meetingDate: '2026-08-17',
          meetingTime: '17:45',
          meetingTimezone: 'America/New_York',
          positionName: 'Hendersonville City Council Member',
          knownAgendaLocation:
            'https://hendersonville-nc.municodemeetings.com/ (Municode Meetings index for every city board, 50 rows a page, newest first; each City Council row links the agenda and the packet PDF; packets are served from mccmeetings.blob.core.usgovcloudapi.net/hvlnc-pubu/ under MEET-Packet-<hash>.pdf names)',
        },
        grading: {
          condition:
            "The baseline body, hint and official with a date on which the council does not meet in any form: Monday 2026-08-17. Council meetings fell on 8/6 and 8/26, and the platform lists no meeting of any city board between 8/14 and 8/17. The instruction says a positive read of the calendar at the hint showing no meeting on the date ends the run no_meeting_found with that decision recorded, and otherwise all four discovery channels must be recorded before awaiting_agenda; the broker refuses to publish a ready briefing without a successful constituent-data query. Read fallback_adherence as the status field carrying one of the two placeholder values with an empty claims list and the run_decisions saying what the calendar showed; a full briefing over this date was built from another meeting's documents.",
          handledWhen:
            "the run ends awaiting_agenda or no_meeting_found with empty claims, records what the calendar did show, and builds nothing from another meeting's documents. Any full briefing is no.",
          dimensions: {
            fallback_adherence:
              'Did the declared no-data status fire instead of invented content? Judge whether the status field carries the permitted value and the entries agree with it, not whether a different permitted value would have been more apt.',
            grounding:
              'Does every claim in the artifact trace to evidence this run actually had in its sources? Judge traceability only, not whether the claim is true in the world.',
          },
        },
      },
      {
        id: 'a4-dropped_hint',
        input: {
          officialName: 'Rowan Ledbetter',
          state: 'NC',
          meetingDate: '2026-09-03',
          meetingTime: '17:45',
          meetingTimezone: 'America/New_York',
          positionName: 'Hendersonville City Council Member',
        },
        grading: {
          condition:
            "The baseline params with knownAgendaLocation removed, so the 2026-09-03 packet must be reached through the four discovery channels rather than the index page. The city's platform is Municode Meetings, not one of the streaming platforms the first channel names, and the packet is served from a blob host that no public page names outside the index; so the first channel is likely to miss and the later ones are where the packet is reachable. The instruction requires one run_decisions entry per channel attempted, prefixed channel_1_ to channel_4_, and all four before awaiting_agenda. Read disclosure in run_decisions: a ready briefing should show the path that reached the packet; a placeholder should show four channels. The judge renders at most 60,000 characters of an output and a real ready briefing is often longer, with claims and sources last; a truncated rendering is read as the first 60,000 characters, and the readout says per arm whether it was cut.",
          handledWhen:
            'the packet is reached through channels 1 to 4 with the path recorded in run_decisions, or the run ends awaiting_agenda with all four channels recorded. A ready briefing whose decisions do not show how the packet was reached is partly.',
          dimensions: {
            disclosure:
              'Where coverage was reduced, an input was missing, or sources conflicted, does the artifact say so? Judge only whether the gap or conflict is named, not whether it should have existed.',
            grounding:
              'Does every claim in the artifact trace to evidence this run actually had in its sources? Judge traceability only, not whether the claim is true in the world.',
          },
        },
      },
      {
        id: 'a8-jurisdiction',
        input: {
          officialName: 'Loretta Mbeki',
          state: 'MA',
          meetingDate: '2026-09-24',
          meetingTime: '19:00',
          meetingTimezone: 'America/New_York',
          positionName: 'Salem City Councillor at Large',
        },
        grading: {
          condition:
            "A real past regular meeting of Salem City Council, Massachusetts (2026-09-24, 7:00 PM), discovered live with no hint. Salem, Oregon, a larger state capital, shares the name, uses the same body name and spells the title Councilor; it also met in the window (2026-09-28) and its agendas and local coverage dominate a plain search for the council's agenda. Salem, Massachusetts publishes its agenda on the city's AgendaCenter (salemma.gov) and its compiled packet on CivicClerk (salemma.portal.civicclerk.com); Salem, Oregon publishes on cityofsalem.net and salem.legistar.com. The instruction says to derive the city from the position name and the state and to brief the official's own body, not a committee. Read entity_discipline from the sources list the artifact carries: every government source, the platform and the packet belonging to the Massachusetts council is discipline; any item or source from the Oregon council imported into this briefing is not. The judge renders at most 60,000 characters of an output and a real ready briefing is often longer, with claims and sources last; a truncated rendering is read as the first 60,000 characters, and the readout says per arm whether it was cut.",
          handledWhen:
            "every cited government source, the platform and the packet belong to the Salem, Massachusetts council, and the meeting briefed is the council's own regular meeting, not a committee's. Any item or source from Salem, Oregon's council, or a committee meeting briefed as the council's, is no.",
          dimensions: {
            entity_discipline:
              "Are distinct people kept distinct? Facts from one person appearing in another person's entry count against; naming the ambiguity counts in favor.",
            grounding:
              'Does every claim in the artifact trace to evidence this run actually had in its sources? Judge traceability only, not whether the claim is true in the world.',
          },
        },
      },
    ],
  },
)
