export type ComplianceSetupOutput = {
  [k: string]: unknown
}
export type ExistingOrdinancesArtifact = {
  [k: string]: unknown
}
/**
 * v2 artifact schema for the meeting_briefing experiment. Drop into manifest.json's output_schema field at port time.
 */
export type MeetingBriefingOutput =
  | MeetingBriefingFull
  | MeetingBriefingPlaceholder
export type MeetingSchedule = MeetingScheduleFound | MeetingScheduleNotFound

export interface AgentJobContracts {
  campaign_tracker_tasks: {
    Input: CampaignTrackerTasksInputParams
    Output: CampaignTrackerTasksArtifact
  }
  compliance_setup: {
    Input: {
      /**
       * Numeric Campaign.id in gp-api. Foreign key the agent passes back to gp-api MCP tools for every state read/write.
       */
      campaign_id: number
      /**
       * Candidate first name. No longer used by the domain pattern catalog (the initials-based patterns were removed); accepted but unused, since the dispatcher still includes it in the params payload.
       */
      candidate_first_name?: string
      /**
       * Candidate last name. Used for the `{last_name}` placeholder in the domain pattern catalog.
       */
      candidate_last_name: string
      /**
       * Clerk user id of the candidate. Broker mints actor-token sessions against this id when proxying MCP calls to gp-api.
       */
      clerk_user_id: string
      /**
       * Per-candidate domain budget. Agent searches at min($10, this) first; if no match and this > 10, retries once at this cap. Above this is a hard `budget_exceeded` blocker.
       */
      domain_budget_cap_usd?: number
      /**
       * YYYY-MM-DD. Drives the {month_abbreviation}/{yyyy} placeholders in the domain pattern catalog (instruction.md).
       */
      election_date: string
      /**
       * Optional hint from the recovery loop indicating the last persisted stage. The agent treats it as a skip-list signal only — the durable compliance state read in Step 1 remains the truth.
       */
      resume_from_stage?:
        | 'pending_dispatch'
        | 'domain_search_started'
        | 'domain_purchased'
        | 'website_content_published'
        | 'pending_website_live'
        | 'website_verified_live'
        | 'tcr_submitted'
        | 'failed'
      /**
       * Fallback run identifier used only when the RUN_ID env var is absent. When RUN_ID is set, the agent must use RUN_ID and ignore this field. The platform's recovery loop correlates runs by the env-var value, so the artifact must never record this field's value if it differs from RUN_ID.
       */
      run_id?: string
      /**
       * Why this run was dispatched. `initial` = first dispatch after Pro purchase. `recovery_resume` = re-dispatch by the recovery loop (ENG-7554) after a wait condition cleared; the agent reads `resume_from_stage` as a skip-list hint but still trusts gp-api durable state as the source of truth.
       */
      trigger: 'initial' | 'recovery_resume'
    }
    Output: ComplianceSetupOutput
  }
  district_issue_pulse: {
    Input: {
      /**
       * Full city name (e.g. Fayetteville).
       */
      city: string
      /**
       * L2 district value to match (e.g. FAYETTEVILLE CITY WARD 2).
       */
      l2DistrictName: string
      /**
       * L2 voter file column name for district (e.g. City_Ward).
       */
      l2DistrictType: string
      /**
       * 2-letter state code (e.g. NC).
       */
      state: string
    }
    Output: DistrictIssuePulse
  }
  district_issue_snapshot: {
    Input: DistrictIssueSnapshotInput
    Output: DistrictIssueSnapshotOutput
  }
  find_existing_ordinances: {
    Input: FindExistingOrdinancesParams
    Output: ExistingOrdinancesArtifact
  }
  meeting_briefing: {
    Input: {
      /**
       * Optional URL to the agenda packet the user pasted in the briefings UI. The agent fetches via pmf_runtime.pdf.download() and skips channel-1-4 discovery. This is always the user's own permanent URL — never a presigned S3 URL. Cite the URL verbatim as the permanent source in run_metadata.agenda_packet_url and sources[]. When the user uploaded a file instead of pasting a URL, this field is absent and the file is pre-staged at /workspace/input/agenda.pdf (the runner fetches it via the broker before the agent boots); the pre-staged file takes precedence over agentic discovery just like agendaPacketUrl does.
       */
      agendaPacketUrl?: string
      /**
       * Optional hint from a prior run describing where the agenda packet was last found. Usually a URL to the city's meetings index, the streaming platform's calendar page, or a CDN parent path. May include prose navigation notes when no single URL captures it. The agent SHOULD try this as channel 0 in Step 2's discovery before falling through to channels 1-4; if the hint is stale, continue with normal discovery — do not bail.
       */
      knownAgendaLocation?: string
      /**
       * L2 district value to match (e.g. "25"). Required if l2DistrictType is set.
       */
      l2DistrictName?: string
      /**
       * L2 voter file column for the official's district (e.g. City_Council_Commissioner_District). ASCII identifier shape — interpolated as a backtick-quoted column name in Databricks SQL. Omit for at-large officials.
       */
      l2DistrictType?: string
      /**
       * Target meeting date in YYYY-MM-DD. Required. The caller (gp-api) supplies this from the official's meeting_schedule. The agent does NOT discover the meeting date — it uses this value as the target and verifies the platform shows a meeting on that date.
       */
      meetingDate: string
      /**
       * Start time of the target meeting in 24-hour HH:MM (local time of meetingTimezone). Optional but recommended. When provided, the agent treats this as the source-of-truth meeting time and copies it through to the artifact's meeting_time field. When omitted, the agent reads the time from the streaming platform.
       */
      meetingTime?: string
      /**
       * IANA timezone name for meetingTime (e.g. "America/New_York"). Optional but recommended. Pair with meetingTime.
       */
      meetingTimezone?: string
      /**
       * Full name of the elected official (e.g. "Shekar Krishnan").
       */
      officialName: string
      /**
       * The EO's position.
       */
      positionName?: string
      /**
       * 2-letter state code (e.g. NY).
       */
      state: string
    }
    Output: MeetingBriefingOutput
  }
  meeting_schedule: {
    Input: MeetingScheduleInput
    Output: MeetingSchedule
  }
  opponent_research: {
    Input: OpponentResearchInputParams
    Output: OpponentResearchArtifact
  }
  opportunities_and_challenges: {
    Input: OpportunitiesAndChallengesInputParams
    Output: OpportunitiesAndChallengesArtifact
  }
  opposition_research: {
    Input: OppositionResearchInputParams
    Output: OppositionResearchArtifact
  }
  race_opponent_actions: {
    Input: OpponentActionsInputParams
    Output: OpponentActionsArtifact
  }
  race_opponent_collection: {
    Input: OpponentDataCollectionInputParams
    Output: OpponentDataCollectionArtifact
  }
  race_opponent_summary: {
    Input: OpponentSummaryInputParams
    Output: OpponentSummaryArtifact
  }
  self_research: {
    Input: SelfResearchInputParams
    Output: SelfResearchArtifact
  }
  top_community_issues: {
    Input: {
      /**
       * Human-readable district description (e.g. 'District 5, Chicago, IL').
       */
      district_descriptor: string
      /**
       * Optional. L2 district value to match (e.g. 'FAYETTEVILLE CITY WARD 2'). Paired with l2_district_type.
       */
      l2_district_name?: string
      /**
       * Optional. L2 voter-file column name for the office's district (e.g. 'City_Ward'). When present with l2_district_name, the Haystaq lean query is scoped to the district; when absent, it falls back to state scope.
       */
      l2_district_type?: string
      /**
       * Name of the elected official's office (e.g. 'City Council Member').
       */
      office: string
      /**
       * GoodParty organization slug for the elected official.
       */
      organization_slug: string
      /**
       * 2-letter state code (e.g. NY).
       */
      state: string
    }
    Output: TopCommunityIssuesOutput
  }
  trending_issues: {
    Input: {
      /**
       * Human-readable district description (e.g. 'District 5, Chicago, IL').
       */
      district_descriptor: string
      /**
       * Name of the elected official's office (e.g. 'City Council Member').
       */
      office: string
      /**
       * GoodParty organization slug for the elected official.
       */
      organization_slug: string
      /**
       * 2-letter state code (e.g. NY).
       */
      state: string
    }
    Output: TrendingIssuesOutput
  }
}
export interface CampaignTrackerTasksInputParams {
  /**
   * The candidate's generated campaign plan (summary text) for personalization context.
   */
  campaign_plan?: string | null
  /**
   * The candidate's story for personalization context.
   */
  campaign_story?: string | null
  /**
   * City / locality name, for local event search.
   */
  city?: string | null
  /**
   * General election date (YYYY-MM-DD), or null. Drives the last-30-days GOTV reframe.
   */
  election_date?: string | null
  /**
   * initial = first full generation; weekly = re-prioritize the upcoming week using the candidate's prior tasks fetched via the tracker-tasks MCP tool.
   */
  mode: 'initial' | 'weekly'
  /**
   * BallotReady brHashId. Trace / idempotency identifier only - the agent does NOT reason over it.
   */
  race_id: string
  /**
   * 2-letter state code, for local event search.
   */
  state?: string | null
  /**
   * Reference date (YYYY-MM-DD) for the upcoming-week window and the GOTV reframe.
   */
  today: string
  /**
   * The candidate we write FOR. Referred to as 'you' in output, never by name.
   */
  user_full_name: string
}
export interface CampaignTrackerTasksArtifact {
  /**
   * ISO 8601 timestamp the agent emits when it writes the artifact.
   */
  generated_at: string
  /**
   * The week's top tasks in priority order (most important first), at most 12. At most 3 may be events (kind='event'). Tasks (kind='task') reference a task_catalog id.
   *
   * @minItems 0
   * @maxItems 12
   */
  tasks:
    | []
    | [
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
      ]
    | [
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
      ]
    | [
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
      ]
    | [
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
      ]
    | [
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
      ]
    | [
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
      ]
    | [
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
      ]
    | [
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
      ]
    | [
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
      ]
    | [
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
      ]
    | [
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
      ]
    | [
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
        {
          /**
           * Event venue address; null for tasks or when not found.
           */
          address?: string | null
          /**
           * task_catalog id for kind='task'; null for events.
           */
          catalog_id?: string | null
          /**
           * Catalog channel for tasks; 'event' for events.
           */
          channel: string
          /**
           * YYYY-MM-DD. The event date for kind='event'; null for undated tasks.
           */
          date?: string | null
          description: string
          kind: 'task' | 'event'
          phase: 'preLaunch' | 'launch' | 'active' | 'gotv'
          title: string
          /**
           * Event page URL (https); null otherwise.
           */
          url?: string | null
        },
      ]
}
export interface DistrictIssuePulse {
  city: string
  generated_at: string
  l2_district_name: string
  l2_district_type: string
  state: string
  /**
   * @minItems 5
   * @maxItems 5
   */
  top_issues: [
    {
      hs_column: string
      issue_label: string
      news: {
        published_date?: string
        source_name: string
        summary: string
        url: string
      }
      rank: number
      voter_count: number
      voter_percentage: number
    },
    {
      hs_column: string
      issue_label: string
      news: {
        published_date?: string
        source_name: string
        summary: string
        url: string
      }
      rank: number
      voter_count: number
      voter_percentage: number
    },
    {
      hs_column: string
      issue_label: string
      news: {
        published_date?: string
        source_name: string
        summary: string
        url: string
      }
      rank: number
      voter_count: number
      voter_percentage: number
    },
    {
      hs_column: string
      issue_label: string
      news: {
        published_date?: string
        source_name: string
        summary: string
        url: string
      }
      rank: number
      voter_count: number
      voter_percentage: number
    },
    {
      hs_column: string
      issue_label: string
      news: {
        published_date?: string
        source_name: string
        summary: string
        url: string
      }
      rank: number
      voter_count: number
      voter_percentage: number
    },
  ]
  total_active_voters: number
}
export interface DistrictIssueSnapshotInput {
  /**
   * Full city name (e.g. Fayetteville).
   */
  city: string
  /**
   * Short issue phrase to match against hs_* columns (e.g. 'affordable housing', 'minimum wage').
   */
  issueKeyword: string
  /**
   * L2 district value to match (e.g. FAYETTEVILLE CITY WARD 2).
   */
  l2DistrictName: string
  /**
   * L2 voter file column name for district (e.g. City_Ward).
   */
  l2DistrictType: string
  /**
   * 2-letter state code (e.g. NC).
   */
  state: string
}
export interface DistrictIssueSnapshotOutput {
  aligned_voter_count: number | null
  aligned_voter_percentage: number | null
  city: string
  generated_at: string
  issue_keyword: string
  issue_label: string
  l2_district_name: string
  l2_district_type: string
  matched_hs_column: string | null
  news: {
    published_date: string
    source_name: string
    summary: string
    title: string
    url: string
  }
  state: string
  total_active_voters: number
}
export interface FindExistingOrdinancesParams {
  /**
   * Optional county name to disambiguate same-name places.
   */
  county?: string
  /**
   * The EO's office/position name (e.g. 'Ramsey City Council'). The agent derives the place name from it.
   */
  office: string
  /**
   * Stable slug for the org/EO the run is for. Echoed into the artifact.
   */
  organization_slug: string
  /**
   * 2-letter state code (e.g. MN).
   */
  state: string
  /**
   * Optional code link the EO pasted at intake; highest-trust source when it verifies.
   */
  user_provided_code_url?: string
}
export interface MeetingBriefingFull {
  /**
   * Full briefing produced. UI renders normal briefing.
   */
  briefing_status: 'briefing_ready' | 'agenda_provided_by_user'
  /**
   * Self-identification of the briefing kind.
   */
  briefing_type:
    | 'city_council_meeting'
    | 'county_legislature_meeting'
    | 'school_board_meeting'
  /**
   * May be empty when briefing_status is awaiting_agenda or no_meeting_found. Capped at 200 to bound the validator's O(claims × sources × extracts) substring scan.
   *
   * @maxItems 200
   */
  claims: {
    claim_id: string
    claim_text: string
    claim_type:
      | 'budget_number'
      | 'vote_count'
      | 'legal_citation'
      | 'staff_recommendation'
      | 'constituent_sentiment'
      | 'news_context'
      | 'historical_context'
      | 'inferred'
    claim_weight: 'high' | 'medium' | 'low'
    item_id: string
    required_source_type:
      | 'agenda_packet'
      | 'government_website'
      | 'news'
      | 'haystaq'
      | 'none'
    route_if_unsupported: 'block_release' | 'omit_claim' | 'flag_as_inferred'
    section:
      | 'overview'
      | 'constituent_sentiment'
      | 'recent_news'
      | 'budget_impact'
      | 'talking_points'
    /**
     * @minItems 1
     * @maxItems 10
     */
    source_extracts:
      | [string]
      | [string, string]
      | [string, string, string]
      | [string, string, string, string]
      | [string, string, string, string, string]
      | [string, string, string, string, string, string]
      | [string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string, string]
      | [
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
          string,
        ]
    /**
     * @minItems 1
     */
    source_ids: [string, ...string[]]
  }[]
  /**
   * Required verbatim disclaimer per required_disclosure.md.
   */
  disclosure: string
  estimated_read_minutes: number
  executive_summary: {
    /**
     * One entry per featured item in top-level items[], in the same order. Empty when no items qualify as featured (and for placeholder briefing_status values).
     *
     * @maxItems 5
     */
    items:
      | []
      | [
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
        ]
      | [
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
        ]
      | [
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
        ]
      | [
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
        ]
      | [
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
        ]
    /**
     * Single framing sentence at the top of the briefing. For briefing_ready artifacts: defaults to 'The following items on your agenda require action and/or have a vote:' (with trailing colon when items follow). For awaiting_agenda / no_meeting_found / error: a check-back or no-meeting message; items[] is empty.
     */
    lead_in: string
  }
  /**
   * Experiment id, echoed from PARAMS.
   */
  experiment_id: string
  /**
   * ISO 8601 UTC timestamp when the briefing was generated.
   */
  generated_at: string
  /**
   * @minItems 1
   */
  items: [
    {
      display: {
        budget_impact?: null | {
          /**
           * @minItems 1
           */
          figures: [
            {
              label: string
              source_id: string
              value: string
            },
            ...{
              label: string
              source_id: string
              value: string
            }[],
          ]
          /**
           * References to ids in the top-level sources[] list that back this section as a whole. Complements per-figure figures[].source_id (which cites the specific document a number was extracted from); this section-level list cites the section overall and renders as inline source pills in the UI. Required-but-may-be-empty: emit [] when the section's narrative draws solely from figures whose source_id already covers it.
           */
          source_ids: string[]
          summary: string
        }
        constituent_sentiment?: null | {
          detail?: string | null
          district_note?: string | null
          haystaq_column: string
          haystaq_status: 'ok' | 'no_match' | 'city_mismatch' | 'no_column'
          mean_score: number
          /**
           * Short string describing what high values represent. Derived from the catalog entry's `meaning` field (e.g. "supports gun control").
           */
          score_direction: string
          /**
           * References to ids in the top-level sources[] list that back this section as a whole. Required-but-may-be-empty: emit [] when no specific source cites the section (rare for haystaq sentiment, which should reference the Haystaq source entry). Authors must not fabricate citations to pad this list.
           */
          source_ids: string[]
          summary: string
          voter_count: number
        }
        recent_news?:
          | null
          | [
              {
                article_type:
                  | 'reporting'
                  | 'opinion'
                  | 'editorial'
                  | 'press_release'
                  | 'government_communication'
                headline: string
                publication: string
                publication_date?: string | null
                /**
                 * Optional cross-reference to a sources[] entry id; populate when the article also appears in sources[].
                 */
                source_id?: string | null
                url: string
              },
            ]
          | [
              {
                article_type:
                  | 'reporting'
                  | 'opinion'
                  | 'editorial'
                  | 'press_release'
                  | 'government_communication'
                headline: string
                publication: string
                publication_date?: string | null
                /**
                 * Optional cross-reference to a sources[] entry id; populate when the article also appears in sources[].
                 */
                source_id?: string | null
                url: string
              },
              {
                article_type:
                  | 'reporting'
                  | 'opinion'
                  | 'editorial'
                  | 'press_release'
                  | 'government_communication'
                headline: string
                publication: string
                publication_date?: string | null
                /**
                 * Optional cross-reference to a sources[] entry id; populate when the article also appears in sources[].
                 */
                source_id?: string | null
                url: string
              },
            ]
          | [
              {
                article_type:
                  | 'reporting'
                  | 'opinion'
                  | 'editorial'
                  | 'press_release'
                  | 'government_communication'
                headline: string
                publication: string
                publication_date?: string | null
                /**
                 * Optional cross-reference to a sources[] entry id; populate when the article also appears in sources[].
                 */
                source_id?: string | null
                url: string
              },
              {
                article_type:
                  | 'reporting'
                  | 'opinion'
                  | 'editorial'
                  | 'press_release'
                  | 'government_communication'
                headline: string
                publication: string
                publication_date?: string | null
                /**
                 * Optional cross-reference to a sources[] entry id; populate when the article also appears in sources[].
                 */
                source_id?: string | null
                url: string
              },
              {
                article_type:
                  | 'reporting'
                  | 'opinion'
                  | 'editorial'
                  | 'press_release'
                  | 'government_communication'
                headline: string
                publication: string
                publication_date?: string | null
                /**
                 * Optional cross-reference to a sources[] entry id; populate when the article also appears in sources[].
                 */
                source_id?: string | null
                url: string
              },
            ]
        summary: string
        talking_points?:
          | null
          | [string, string, string]
          | [string, string, string, string]
          | [string, string, string, string, string]
      }
      id: string
      /**
       * Agenda item number as a string (e.g. '5F'). Set to null only for the single placeholder item emitted when briefing_status is awaiting_agenda or no_meeting_found.
       */
      item_number: string | null
      research: {
        full_treatment: null | {
          budget_detail: null | {
            /**
             * @minItems 1
             */
            figures: [
              {
                label: string
                value: string
                verbatim_extract: string
              },
              ...{
                label: string
                value: string
                verbatim_extract: string
              }[],
            ]
          }
          haystaq_detail: null | {
            city_mean_score?: number | null
            city_voter_count?: number | null
            complementary_field?: string | null
            district_mean_score?: number | null
            district_voter_count?: number | null
            haystaq_column: string | null
            haystaq_status: 'ok' | 'no_match' | 'city_mismatch' | 'no_column'
            query_executed?: string | null
          }
          news_articles:
            | null
            | {
                article_type:
                  | 'reporting'
                  | 'opinion'
                  | 'editorial'
                  | 'press_release'
                  | 'government_communication'
                body_text: string
                headline: string
                publication: string
                publication_date?: string | null
                url: string
              }[]
        }
        /**
         * @minItems 1
         */
        raw_context: [
          {
            chunk_id: string
            item_id: string
            item_title: string
            /**
             * @minItems 1
             */
            pages: [number, ...number[]]
            section_heading?: string | null
            source_id: string
            text: string
            tier: 'featured' | 'queued' | 'standard'
          },
          ...{
            chunk_id: string
            item_id: string
            item_title: string
            /**
             * @minItems 1
             */
            pages: [number, ...number[]]
            section_heading?: string | null
            source_id: string
            text: string
            tier: 'featured' | 'queued' | 'standard'
          }[],
        ]
      }
      tier: 'featured' | 'queued' | 'standard'
      /**
       * Free-form short snake_case reasons explaining the tier assignment. Preferred values for the common cases: 'vote_required', 'public_position_required', 'budget_threshold', 'constituent_alignment', 'procedural', 'ceremonial', 'consent_routine', 'first_reading_only', 'received_and_filed_or_callup', 'land_use_referral', 'out_of_district', 'symbolic_resolution', 'placeholder'. Agent may use a domain-specific reason when none of the preferred values fit, but reuse preferred values when they apply (do not invent 'procedural_minutes' when 'procedural' already covers it).
       *
       * @minItems 1
       */
      tier_reason: [string, ...string[]]
      title: string
      vote_required: boolean
    },
    ...{
      display: {
        budget_impact?: null | {
          /**
           * @minItems 1
           */
          figures: [
            {
              label: string
              source_id: string
              value: string
            },
            ...{
              label: string
              source_id: string
              value: string
            }[],
          ]
          /**
           * References to ids in the top-level sources[] list that back this section as a whole. Complements per-figure figures[].source_id (which cites the specific document a number was extracted from); this section-level list cites the section overall and renders as inline source pills in the UI. Required-but-may-be-empty: emit [] when the section's narrative draws solely from figures whose source_id already covers it.
           */
          source_ids: string[]
          summary: string
        }
        constituent_sentiment?: null | {
          detail?: string | null
          district_note?: string | null
          haystaq_column: string
          haystaq_status: 'ok' | 'no_match' | 'city_mismatch' | 'no_column'
          mean_score: number
          /**
           * Short string describing what high values represent. Derived from the catalog entry's `meaning` field (e.g. "supports gun control").
           */
          score_direction: string
          /**
           * References to ids in the top-level sources[] list that back this section as a whole. Required-but-may-be-empty: emit [] when no specific source cites the section (rare for haystaq sentiment, which should reference the Haystaq source entry). Authors must not fabricate citations to pad this list.
           */
          source_ids: string[]
          summary: string
          voter_count: number
        }
        recent_news?:
          | null
          | [
              {
                article_type:
                  | 'reporting'
                  | 'opinion'
                  | 'editorial'
                  | 'press_release'
                  | 'government_communication'
                headline: string
                publication: string
                publication_date?: string | null
                /**
                 * Optional cross-reference to a sources[] entry id; populate when the article also appears in sources[].
                 */
                source_id?: string | null
                url: string
              },
            ]
          | [
              {
                article_type:
                  | 'reporting'
                  | 'opinion'
                  | 'editorial'
                  | 'press_release'
                  | 'government_communication'
                headline: string
                publication: string
                publication_date?: string | null
                /**
                 * Optional cross-reference to a sources[] entry id; populate when the article also appears in sources[].
                 */
                source_id?: string | null
                url: string
              },
              {
                article_type:
                  | 'reporting'
                  | 'opinion'
                  | 'editorial'
                  | 'press_release'
                  | 'government_communication'
                headline: string
                publication: string
                publication_date?: string | null
                /**
                 * Optional cross-reference to a sources[] entry id; populate when the article also appears in sources[].
                 */
                source_id?: string | null
                url: string
              },
            ]
          | [
              {
                article_type:
                  | 'reporting'
                  | 'opinion'
                  | 'editorial'
                  | 'press_release'
                  | 'government_communication'
                headline: string
                publication: string
                publication_date?: string | null
                /**
                 * Optional cross-reference to a sources[] entry id; populate when the article also appears in sources[].
                 */
                source_id?: string | null
                url: string
              },
              {
                article_type:
                  | 'reporting'
                  | 'opinion'
                  | 'editorial'
                  | 'press_release'
                  | 'government_communication'
                headline: string
                publication: string
                publication_date?: string | null
                /**
                 * Optional cross-reference to a sources[] entry id; populate when the article also appears in sources[].
                 */
                source_id?: string | null
                url: string
              },
              {
                article_type:
                  | 'reporting'
                  | 'opinion'
                  | 'editorial'
                  | 'press_release'
                  | 'government_communication'
                headline: string
                publication: string
                publication_date?: string | null
                /**
                 * Optional cross-reference to a sources[] entry id; populate when the article also appears in sources[].
                 */
                source_id?: string | null
                url: string
              },
            ]
        summary: string
        talking_points?:
          | null
          | [string, string, string]
          | [string, string, string, string]
          | [string, string, string, string, string]
      }
      id: string
      /**
       * Agenda item number as a string (e.g. '5F'). Set to null only for the single placeholder item emitted when briefing_status is awaiting_agenda or no_meeting_found.
       */
      item_number: string | null
      research: {
        full_treatment: null | {
          budget_detail: null | {
            /**
             * @minItems 1
             */
            figures: [
              {
                label: string
                value: string
                verbatim_extract: string
              },
              ...{
                label: string
                value: string
                verbatim_extract: string
              }[],
            ]
          }
          haystaq_detail: null | {
            city_mean_score?: number | null
            city_voter_count?: number | null
            complementary_field?: string | null
            district_mean_score?: number | null
            district_voter_count?: number | null
            haystaq_column: string | null
            haystaq_status: 'ok' | 'no_match' | 'city_mismatch' | 'no_column'
            query_executed?: string | null
          }
          news_articles:
            | null
            | {
                article_type:
                  | 'reporting'
                  | 'opinion'
                  | 'editorial'
                  | 'press_release'
                  | 'government_communication'
                body_text: string
                headline: string
                publication: string
                publication_date?: string | null
                url: string
              }[]
        }
        /**
         * @minItems 1
         */
        raw_context: [
          {
            chunk_id: string
            item_id: string
            item_title: string
            /**
             * @minItems 1
             */
            pages: [number, ...number[]]
            section_heading?: string | null
            source_id: string
            text: string
            tier: 'featured' | 'queued' | 'standard'
          },
          ...{
            chunk_id: string
            item_id: string
            item_title: string
            /**
             * @minItems 1
             */
            pages: [number, ...number[]]
            section_heading?: string | null
            source_id: string
            text: string
            tier: 'featured' | 'queued' | 'standard'
          }[],
        ]
      }
      tier: 'featured' | 'queued' | 'standard'
      /**
       * Free-form short snake_case reasons explaining the tier assignment. Preferred values for the common cases: 'vote_required', 'public_position_required', 'budget_threshold', 'constituent_alignment', 'procedural', 'ceremonial', 'consent_routine', 'first_reading_only', 'received_and_filed_or_callup', 'land_use_referral', 'out_of_district', 'symbolic_resolution', 'placeholder'. Agent may use a domain-specific reason when none of the preferred values fit, but reuse preferred values when they apply (do not invent 'procedural_minutes' when 'procedural' already covers it).
       *
       * @minItems 1
       */
      tier_reason: [string, ...string[]]
      title: string
      vote_required: boolean
    }[],
  ]
  /**
   * Customary location for the meeting (e.g. 'City Hall Council Chambers, 200 Main St'). Required-but-may-be-empty: emit an empty string when no source for the run mentions a venue (e.g. a user-supplied agenda PDF that lacks a header). Otherwise prefer the room-level location and fall back to building + street address when only the building is given.
   */
  location: string
  /**
   * YYYY-MM-DD. For agenda_provided_by_user or awaiting_agenda runs, this is the target meeting date; for no_meeting_found it may be an estimated next date.
   */
  meeting_date: string
  /**
   * Official name of the meeting body as the source refers to it (e.g. 'City Council', 'Planning Board'). Used as the list-row title in the candidate dashboard. Mirrors meeting_schedule.meeting_name when a schedule exists.
   */
  meeting_name: string
  /**
   * Start time of the meeting in 24-hour HH:MM format, in the local timezone given by meeting_timezone. Briefings own this independently of meeting_schedule so the row is self-sufficient.
   */
  meeting_time: string
  /**
   * IANA timezone name for meeting_time (e.g. 'America/Chicago'). Use the timezone the governing body publishes the meeting in, not UTC.
   */
  meeting_timezone: string
  official_name: string
  required_data_points: {
    allowed_source_types?: (
      | 'agenda_packet'
      | 'news'
      | 'government_website'
      | 'campaign'
      | 'haystaq'
    )[]
    citation_required: boolean
    name: string
    required: boolean
    scope: 'all_items' | 'featured_queued' | 'featured'
    skip_reasons_allowed?: string[]
  }[]
  run_metadata: {
    /**
     * Permanent URL to the agenda packet. May be null when briefing_status is awaiting_agenda or no_meeting_found.
     */
    agenda_packet_url: string | null
    briefing_version?: string
    /**
     * Best current prose describing where future agenda packets will likely be found for this body, persisted by gp-api as a hint for subsequent runs. Prefer a URL to the PARENT page that lists meetings (e.g. the streaming platform's calendar, the city's agendas index, a CDN directory) — not the deep link to today's specific packet PDF. Prose with multi-step navigation is allowed when no single URL captures it. Emit even on awaiting_agenda / no_meeting_found runs when the parent page was still reachable; set to null only when no plausible future-run starting point exists.
     */
    discovered_agenda_location: string | null
    /**
     * Curated trail of agent judgment calls. Separate from conversation/log.txt; this is QA-facing.
     */
    run_decisions?: {
      decision: string
      reason: string
      timestamp: string
    }[]
    source_bundle_retrieved_at: string
  }
  sources: {
    article_date?: string | null
    article_type?:
      | 'reporting'
      | 'opinion'
      | 'editorial'
      | 'press_release'
      | 'government_communication'
      | null
    district_voters_n?: number | null
    haystaq_column?: string | null
    id: string
    name: string
    page_number?: number | null
    publisher?: string | null
    retrieved_at: string
    retrieved_text_or_snapshot: string
    score_value?: number | null
    section_heading?: string | null
    source_type:
      | 'agenda_packet'
      | 'news'
      | 'government_website'
      | 'campaign'
      | 'haystaq'
    specific_claim_found?: string | null
    url?: string | null
  }[]
}
export interface MeetingBriefingPlaceholder {
  /**
   * Early-exit / placeholder artifact. UI renders a check-back state. Use 'awaiting_agenda' when the meeting is on the calendar but the agenda packet has not been published. Use 'no_meeting_found' when the streaming platform shows no meeting of the official's body on the caller-supplied PARAMS.meetingDate (stale schedule signal). Use 'error' for unrecoverable run failures — populate run_metadata.run_decisions[] with the diagnostic trail.
   */
  briefing_status: 'awaiting_agenda' | 'no_meeting_found' | 'error'
  /**
   * Self-identification of the briefing kind.
   */
  briefing_type:
    | 'city_council_meeting'
    | 'county_legislature_meeting'
    | 'school_board_meeting'
  /**
   * Always empty for placeholder/early-exit artifacts.
   *
   * @maxItems 0
   */
  claims: []
  /**
   * Required verbatim disclaimer per required_disclosure.md.
   */
  disclosure: string
  estimated_read_minutes: number
  executive_summary: {
    /**
     * One entry per featured item in top-level items[], in the same order. Empty when no items qualify as featured (and for placeholder briefing_status values).
     *
     * @maxItems 5
     */
    items:
      | []
      | [
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
        ]
      | [
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
        ]
      | [
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
        ]
      | [
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
        ]
      | [
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
          {
            community_issue_id?: string
            /**
             * Must resolve to an entry in top-level items[] with tier='featured'. UI uses this to link the entry to the corresponding deep-dive panel.
             */
            item_id: string
            /**
             * One-sentence distillation of items[item_id].display.summary (the Step 9 Overview) — same facts, tighter framing.
             */
            overview: string
            priority_id?: string
            /**
             * Item title shown before the em-dash. Must verbatim equal items[item_id].title (denormalized for renderer convenience).
             */
            title: string
          },
        ]
    /**
     * Single framing sentence at the top of the briefing. For briefing_ready artifacts: defaults to 'The following items on your agenda require action and/or have a vote:' (with trailing colon when items follow). For awaiting_agenda / no_meeting_found / error: a check-back or no-meeting message; items[] is empty.
     */
    lead_in: string
  }
  /**
   * Experiment id, echoed from PARAMS.
   */
  experiment_id: string
  /**
   * ISO 8601 UTC timestamp when the briefing was generated.
   */
  generated_at: string
  /**
   * @minItems 1
   * @maxItems 1
   */
  items: [
    {
      display: {
        budget_impact?: null
        constituent_sentiment?: null
        recent_news?: null
        summary: string
        talking_points?: null
      }
      id: 'item_001'
      item_number: null
      research: {
        full_treatment: null
        /**
         * @minItems 1
         */
        raw_context: [
          {
            chunk_id: string
            item_id: string
            item_title: string
            /**
             * @minItems 1
             */
            pages: [number, ...number[]]
            section_heading?: string | null
            source_id: string
            text: string
            tier: 'featured' | 'queued' | 'standard'
          },
          ...{
            chunk_id: string
            item_id: string
            item_title: string
            /**
             * @minItems 1
             */
            pages: [number, ...number[]]
            section_heading?: string | null
            source_id: string
            text: string
            tier: 'featured' | 'queued' | 'standard'
          }[],
        ]
      }
      tier: 'standard'
      /**
       * @minItems 1
       * @maxItems 1
       */
      tier_reason: ['placeholder']
      title: string
      vote_required: false
    },
  ]
  /**
   * Customary location for the meeting. Required-but-may-be-empty: populate when the meeting is identified (awaiting_agenda), emit an empty string when no_meeting_found or error.
   */
  location: string
  /**
   * YYYY-MM-DD. For agenda_provided_by_user or awaiting_agenda runs, this is the target meeting date; for no_meeting_found it may be an estimated next date.
   */
  meeting_date: string
  /**
   * Official name of the meeting body (e.g. 'City Council'). Required-but-may-be-empty: populate when the meeting is identified (awaiting_agenda), emit an empty string when no_meeting_found or error.
   */
  meeting_name: string
  /**
   * Start time of the meeting in 24-hour HH:MM format, in the local timezone given by meeting_timezone. Required-but-may-be-empty: populate when the meeting is identified (awaiting_agenda), emit an empty string when no_meeting_found or error.
   */
  meeting_time: string
  /**
   * IANA timezone name for meeting_time (e.g. 'America/Chicago'). Required-but-may-be-empty: populate when the meeting is identified, emit an empty string when no_meeting_found or error.
   */
  meeting_timezone: string
  official_name: string
  required_data_points: {
    allowed_source_types?: (
      | 'agenda_packet'
      | 'news'
      | 'government_website'
      | 'campaign'
      | 'haystaq'
    )[]
    citation_required: boolean
    name: string
    required: boolean
    scope: 'all_items' | 'featured_queued' | 'featured'
    skip_reasons_allowed?: string[]
  }[]
  run_metadata: {
    /**
     * Permanent URL to the agenda packet. May be null when briefing_status is awaiting_agenda or no_meeting_found.
     */
    agenda_packet_url: string | null
    briefing_version?: string
    /**
     * Best current prose describing where future agenda packets will likely be found for this body, persisted by gp-api as a hint for subsequent runs. Prefer a URL to the PARENT page that lists meetings (e.g. the streaming platform's calendar, the city's agendas index, a CDN directory) — not the deep link to today's specific packet PDF. Prose with multi-step navigation is allowed when no single URL captures it. Emit even on awaiting_agenda / no_meeting_found runs when the parent page was still reachable; set to null only when no plausible future-run starting point exists.
     */
    discovered_agenda_location: string | null
    /**
     * Curated trail of agent judgment calls. Separate from conversation/log.txt; this is QA-facing.
     */
    run_decisions?: {
      decision: string
      reason: string
      timestamp: string
    }[]
    source_bundle_retrieved_at: string
  }
  sources: {
    article_date?: string | null
    article_type?:
      | 'reporting'
      | 'opinion'
      | 'editorial'
      | 'press_release'
      | 'government_communication'
      | null
    district_voters_n?: number | null
    haystaq_column?: string | null
    id: string
    name: string
    page_number?: number | null
    publisher?: string | null
    retrieved_at: string
    retrieved_text_or_snapshot: string
    score_value?: number | null
    section_heading?: string | null
    source_type:
      | 'agenda_packet'
      | 'news'
      | 'government_website'
      | 'campaign'
      | 'haystaq'
    specific_claim_found?: string | null
    url?: string | null
  }[]
}
export interface MeetingScheduleInput {
  /**
   * Opaque gp-api ElectedOffice.id; passed through to the callback. Not used during research.
   */
  elected_office_id?: string
  /**
   * Optional hint from a prior run describing where the meeting schedule was last found. Usually a URL to the city's meetings page or a municipal-code section, but may include prose navigation notes. The agent SHOULD try this location first before falling back to full WebSearch discovery; if the hint is stale, the agent must continue with normal discovery — do not bail.
   */
  known_schedule_location?: string
  /**
   * Full position/office name as it appears to the candidate (e.g. 'Burnsville City Council Member', 'Mayor of Cheyenne'). Usually contains the jurisdiction verbatim; when generic (e.g. just 'City Council'), the agent must infer the city from the position + state via WebSearch.
   */
  office: string
  /**
   * Two-letter state code (e.g. MN).
   */
  state: string
}
export interface MeetingScheduleFound {
  /**
   * Best current prose describing where the meeting schedule can be found, persisted by gp-api as a hint for future runs. Prefer a URL to the parent page that lists the schedule (e.g. the city's meetings index, the municipal-code section). Prose with multi-step navigation is allowed when no single URL captures it. Set to null only when no location is meaningfully recoverable.
   */
  discovered_schedule_location: string | null
  /**
   * Typical meeting length in minutes.
   */
  duration_minutes: number
  generated_at: string
  /**
   * One-sentence English description of the recurrence; must match the RRULE semantically.
   */
  human: string
  /**
   * Customary location for regular meetings (e.g. 'City Hall Council Chambers, 200 Main St'). Falls back to a city-hall address if the source doesn't state a specific room.
   */
  location: string
  /**
   * Official name of the meeting body as the source refers to it (e.g. 'City Council', 'Planning Board'). Used as the list-row title in the candidate dashboard.
   */
  meeting_name: string
  /**
   * iCalendar RFC 5545 RRULE string. MUST NOT contain DTSTART.
   */
  rrule: string
  /**
   * @minItems 1
   * @maxItems 20
   */
  sources:
    | [
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
  status: 'found'
  /**
   * 24-hour HH:MM in local time.
   */
  time: string
  /**
   * IANA timezone name (e.g. America/Denver).
   */
  timezone: string
}
export interface MeetingScheduleNotFound {
  /**
   * For not_found runs, the best lead on where a schedule might be locatable on a future run (e.g. the city's meetings page even though no recurrence was stated there). Null when no useful lead exists. Persisted by gp-api as a hint for future runs.
   */
  discovered_schedule_location: string | null
  duration_minutes: number
  generated_at: string
  human: string
  location: string
  meeting_name: string
  rrule: string
  /**
   * @maxItems 20
   */
  sources:
    | []
    | [
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
    | [
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
        {
          note: string
          url: string
        },
      ]
  status: 'not_found'
  time: string
  timezone: string
}
export interface OpponentResearchInputParams {
  /**
   * The candidate's own platform / positions, for context only. Used to frame which contrasts matter; the agent does NOT research the candidate here, only the opponent. Sourced from the candidate's website (the Pro-upgrade profile capture). Any field may be null when unwritten.
   */
  candidate_platform?: {
    /**
     * The candidate's background / bio.
     */
    background?: string | null
    /**
     * The issues the candidate is running on.
     */
    issues?: string | null
  } | null
  /**
   * The named opponent to research. The lawful-use case for the L2 residency lookup on this named person has been confirmed.
   */
  opponent: {
    /**
     * The opponent's full name. Used for source discovery via WebSearch, to confirm a fetched page is about this person, and as the registration name to match in the L2 residency query.
     */
    full_name: string
    /**
     * true if known to be the incumbent, false if known not to be, null if unknown.
     */
    is_incumbent?: boolean | null
    /**
     * Optional hints: the opponent's public social-media profile URLs.
     */
    social_urls?: string[]
    /**
     * Optional hint: the opponent's campaign website. When present, fetch directly; when null/absent, discover via WebSearch.
     */
    website_url?: string | null
  }
  /**
   * The race the opponent is running in, hydrated by gp-api before dispatch. Disambiguates the right person/page during discovery (same office, jurisdiction, cycle).
   */
  race_context: {
    /**
     * City / jurisdiction name, or null. The broker injects this as a WHERE clause on the L2 residency query when present.
     */
    city?: string | null
    /**
     * The election date for this race, or null. Confirms the right cycle during discovery.
     */
    election_date?: string | null
    /**
     * Readable office name (e.g. 'Fayetteville City Council').
     */
    office_name: string
    /**
     * 2-letter state code (e.g. NC). The broker injects this as the WHERE on the L2 residency query.
     */
    state: string
    [k: string]: unknown
  }
}
export interface OpponentResearchArtifact {
  /**
   * One entry per verified vulnerability in the opponent's public record. A finding is emitted ONLY when its source_extract literally appears on the fetched source_url (or, for a residency finding, when an L2 registration row matched). Findings that fail verification are dropped, never invented. The array may be empty.
   */
  findings: {
    /**
     * Which vulnerability category this finding belongs to.
     */
    category:
      | 'residency'
      | 'record'
      | 'statements'
      | 'funding'
      | 'conflicts'
      | 'narrative'
    /**
     * The vulnerability stated plainly: what the candidate could draw a contrast on, grounded in the opponent's own public conduct.
     */
    claim: string
    /**
     * Optional date the underlying event occurred (not the retrieval date), or null when undated.
     */
    occurred_at?: string | null
    /**
     * For web findings: a verbatim passage from the fetched page that substantiates the claim (verified via verify_quote). For a residency finding: the matched registration fields rendered as text (e.g. registration state/date).
     */
    source_extract: string
    /**
     * Optional human-readable title of the source page.
     */
    source_title?: string
    /**
     * For web findings: the page actually fetched (the broker's returned X-Source-URL after any redirect), matching ^https?://. For a residency finding sourced from L2 (not a fetchable URL), a stable dataset reference (e.g. 'l2:int__l2_nationwide_uniform_w_haystaq').
     */
    source_url: string
  }[]
  generated_at: string
  /**
   * Whether the L2 residency query returned a matching registration for the named opponent. 'available' when a row matched and a residency finding was produced; 'unavailable' when no row matched (no residency finding emitted, never fabricated). The broker's data-required gate is carved out for 'unavailable' so a web-only result can still publish.
   */
  residency_data: 'available' | 'unavailable'
}
export interface OpportunitiesAndChallengesInputParams {
  /**
   * The PRIMARY election stage's candidate roster only (candidate_count + candidates), or null when the race has no primary. We deliberately omit the race-level numbers here (win number, projected turnout, contacts goal, voter-file counts) because they are stage-specific and differ from the general-election numbers the plan is built on, and the office metadata / dates / partisan_type because they are identical to campaign_strategy_context. For offices that hold a primary, this is the real filed field; the general roster is often empty.
   */
  campaign_primary_strategy_context?: {
    candidate_count: number
    /**
     * The filed candidate roster for the primary stage of this race.
     */
    candidates: {
      email?: string | null
      first_name: string
      full_name: string
      gp_candidate_id?: string | null
      is_incumbent?: boolean | null
      last_name: string
      party?: string | null
      website_url?: string | null
    }[]
  } | null
  /**
   * The candidate's own campaign story, captured on the Campaign Story page and hydrated by gp-api before dispatch: why they're running, their background, and the issues they'll fight for. First-person positioning context for the candidate ('you'). A field is null when the candidate hasn't written it yet - treat null or empty as 'not provided' and never invent content.
   */
  campaign_story?: {
    /**
     * The candidate's background: career, community ties, and the personal story behind the candidacy.
     */
    background: string | null
    /**
     * The concrete issues the candidate will fight for in their first term.
     */
    issues: string | null
    /**
     * Why the candidate is running - the moment, people, or conviction behind the campaign.
     */
    why: string | null
  }
  /**
   * The election-api campaign-strategy-context result, hydrated by gp-api before dispatch. The agent does NOT call election-api; this is the source of the race numbers the opportunities/challenges are derived from. This object reflects the GENERAL election stage; the primary stage (when one exists) is in campaign_primary_strategy_context.
   */
  campaign_strategy_context: {
    candidate_count: number
    candidate_office: string | null
    /**
     * Provisional seed roster - incomplete and lagging (the real field is owned by opposition_research). Do NOT derive opportunities/challenges from candidate_count, this roster, or is_incumbent; base bullets on the race numbers + web search.
     */
    candidates: {
      email?: string | null
      first_name: string
      full_name: string
      gp_candidate_id?: string | null
      is_incumbent?: boolean | null
      last_name: string
      party?: string | null
      website_url?: string | null
    }[]
    contacts_needed_estimate?: number | null
    filing_date_end?: string | null
    general_election_date?: string | null
    number_of_seats?: number | null
    office_level?: string | null
    office_type?: string | null
    official_office_name?: string | null
    /**
     * Race partisan type from election-api (e.g. 'partisan' / 'nonpartisan'). 'nonpartisan' means party labels are voter-registration noise, not the contest. May be null until election-api populates it.
     */
    partisan_type?: string | null
    primary_election_date?: string | null
    projected_turnout?: number | null
    registered_voters?: number | null
    relevant_election_date?: string | null
    state?: string | null
    unique_cellphones?: number | null
    unique_landlines?: number | null
    win_number_effective?: number | null
  }
  /**
   * The candidate's party when user_party_affiliation == 'Other'.
   */
  other_party?: string | null
  /**
   * BallotReady brHashId. Trace / idempotency identifier only - the agent does NOT reason over it or look anything up with it.
   */
  race_id: string
  /**
   * The candidate's email. Used to mark is_user against the roster (exact match, case-insensitive + trimmed).
   */
  user_email: string
  user_first_name?: string | null
  /**
   * The candidate we write FOR. Referred to as 'you' in output, never by name.
   */
  user_full_name: string
  user_last_name?: string | null
  /**
   * Party label, or null. 'Other' means the real value is in other_party.
   */
  user_party_affiliation?: string | null
  [k: string]: unknown
}
export interface OpportunitiesAndChallengesArtifact {
  /**
   * Up to 3 structural risks for this race, each a finished 1-3 sentence bullet with its citation inlined as '... ([source](url))'. At least 1.
   *
   * @minItems 1
   * @maxItems 3
   */
  challenges: [string] | [string, string] | [string, string, string]
  /**
   * Up to 3 structural advantages for this race, each a finished 1-3 sentence bullet with its citation inlined as '... ([source](url))'. At least 1.
   *
   * @minItems 1
   * @maxItems 3
   */
  opportunities: [string] | [string, string] | [string, string, string]
}
export interface OppositionResearchInputParams {
  /**
   * The PRIMARY election stage's candidate roster only (candidate_count + candidates), or null when the race has no primary. We deliberately omit the race-level numbers here (win number, projected turnout, contacts goal, voter-file counts) because they are stage-specific and differ from the general-election numbers the plan is built on, and the office metadata / dates / partisan_type because they are identical to campaign_strategy_context. For offices that hold a primary, this is the real filed field; the general roster is often empty.
   */
  campaign_primary_strategy_context?: {
    candidate_count: number
    /**
     * The filed candidate roster for the primary stage of this race.
     */
    candidates: {
      email?: string | null
      first_name: string
      full_name: string
      gp_candidate_id?: string | null
      is_incumbent?: boolean | null
      last_name: string
      party?: string | null
      website_url?: string | null
    }[]
  } | null
  /**
   * The candidate's own campaign story, captured on the Campaign Story page and hydrated by gp-api before dispatch: why they're running, their background, and the issues they'll fight for. First-person positioning context for the candidate ('you'). A field is null when the candidate hasn't written it yet - treat null or empty as 'not provided' and never invent content. This is the candidate's own framing, NOT opponent data.
   */
  campaign_story?: {
    /**
     * The candidate's background: career, community ties, and the personal story behind the candidacy.
     */
    background: string | null
    /**
     * The concrete issues the candidate will fight for in their first term.
     */
    issues: string | null
    /**
     * Why the candidate is running - the moment, people, or conviction behind the campaign.
     */
    why: string | null
  }
  /**
   * The election-api campaign-strategy-context result, hydrated by gp-api before dispatch. The agent does NOT call election-api; this is its only roster source besides web search. This object reflects the GENERAL election stage; the primary stage (when one exists) is in campaign_primary_strategy_context.
   */
  campaign_strategy_context: {
    candidate_count: number
    candidate_office: string | null
    /**
     * Full seed roster (NOT pre-filtered). The agent marks the candidate via is_user and excludes them; it does not receive a pre-trimmed opponent list.
     */
    candidates: {
      email?: string | null
      first_name: string
      full_name: string
      gp_candidate_id?: string | null
      is_incumbent?: boolean | null
      last_name: string
      party?: string | null
      website_url?: string | null
    }[]
    contacts_needed_estimate?: number | null
    filing_date_end?: string | null
    general_election_date?: string | null
    number_of_seats?: number | null
    office_level?: string | null
    office_type?: string | null
    official_office_name?: string | null
    /**
     * Race partisan type from election-api (e.g. 'partisan' / 'nonpartisan'). 'nonpartisan' means the party labels are voter-registration noise, not the contest. May be null until election-api populates it. Not enum-constrained - election-api is the source of truth for the value.
     */
    partisan_type?: string | null
    primary_election_date?: string | null
    projected_turnout?: number | null
    registered_voters?: number | null
    relevant_election_date?: string | null
    state?: string | null
    unique_cellphones?: number | null
    unique_landlines?: number | null
    win_number_effective?: number | null
  }
  /**
   * The candidate's party when user_party_affiliation == 'Other'.
   */
  other_party?: string | null
  /**
   * BallotReady brHashId. Trace / idempotency identifier only - the agent does NOT reason over it or look anything up with it.
   */
  race_id: string
  /**
   * The candidate's email. Used to mark is_user against the roster (exact match, case-insensitive + trimmed).
   */
  user_email: string
  user_first_name?: string | null
  /**
   * The candidate we write FOR. Referred to as 'you' in output, never by name. Fallback for is_user when the email doesn't match a roster row.
   */
  user_full_name: string
  user_last_name?: string | null
  /**
   * Party label, or null. 'Other' means the real value is in other_party.
   */
  user_party_affiliation?: string | null
  [k: string]: unknown
}
export interface OppositionResearchArtifact {
  /**
   * Confirmed opponents running in this race (seed roster plus any web-confirmed late filers, candidate excluded). Empty array if uncontested. gp-api renders the campaign-plan Opposition Research section from this structured data.
   */
  opponents: {
    full_name: string
    /**
     * true if known to be the incumbent, false if known not to be, null if unknown.
     */
    incumbent: boolean | null
    /**
     * Party name, 'Nonpartisan', or 'Unknown'.
     */
    party_affiliation: string
  }[]
}
export interface OpponentActionsInputParams {
  /**
   * The candidate's own platform, hydrated by gp-api from Website.content.about (same shape race_opponent_summary consumes). Candidate-side claims on cards come only from here. Absent or thin means fewer cards.
   */
  candidate_platform?: {
    /**
     * The candidate's own biography paragraph, as captured for their candidate site.
     */
    bio?: string
    /**
     * The candidate's own issue positions. A card's candidate-side commitment is drawn only from these, never invented.
     */
    issues?: {
      /**
       * The candidate's own stated stance on this issue.
       */
      description: string
      /**
       * Short issue title (e.g. 'Housing affordability').
       */
      title: string
    }[]
  }
  /**
   * L2 district value to match (e.g. HENDERSONVILLE CITY). Absent together with l2_district_type.
   */
  l2_district_name?: string
  /**
   * L2 voter file column name for the district (e.g. City, City_Ward), from gp-api's DistrictResolverService. Absent when the org has no resolvable position; then the agent skips Databricks entirely and every card goes out numberless (haystaq_status: no_district).
   */
  l2_district_type?: string
  /**
   * The persisted race_opponent_summary sections per opponent, as plain text, hydrated by gp-api. NOT raw collected pages. This text plus candidate_platform is the ONLY factual source for card copy.
   *
   * @minItems 1
   */
  opponents: [
    {
      /**
       * The summary's background section text, or null when the summary carried none.
       */
      background_text: string | null
      /**
       * The summary's issues_that_matter bullet strings, or null when the summary carried none.
       */
      issues_that_matter: string[] | null
      /**
       * The opponent this summary is about. Echoed verbatim as opponent_name on cards that contrast against them.
       */
      opponent_name: string
      /**
       * The summary's overview section text, or null when the summary carried none.
       */
      overview_text: string | null
      /**
       * The persisted summary's relative threat tier. Drives card ordering: primary_threat angles first, then watch_closely, then low_priority.
       */
      threat_tier: 'primary_threat' | 'watch_closely' | 'low_priority'
    },
    ...{
      /**
       * The summary's background section text, or null when the summary carried none.
       */
      background_text: string | null
      /**
       * The summary's issues_that_matter bullet strings, or null when the summary carried none.
       */
      issues_that_matter: string[] | null
      /**
       * The opponent this summary is about. Echoed verbatim as opponent_name on cards that contrast against them.
       */
      opponent_name: string
      /**
       * The summary's overview section text, or null when the summary carried none.
       */
      overview_text: string | null
      /**
       * The persisted summary's relative threat tier. Drives card ordering: primary_threat angles first, then watch_closely, then low_priority.
       */
      threat_tier: 'primary_threat' | 'watch_closely' | 'low_priority'
    }[],
  ]
  /**
   * The race the opponents are running in, hydrated by gp-api. Light context for phrasing only (office / jurisdiction / election date). The agent does NOT reason over it to add facts.
   */
  race_context: {
    /**
     * City / jurisdiction name, or null.
     */
    city?: string | null
    /**
     * The election date for this race, or null.
     */
    election_date?: string | null
    /**
     * Readable office name (e.g. 'Hendersonville City Council').
     */
    office_name?: string | null
    /**
     * 2-letter state code (e.g. NC), or null.
     */
    state?: string | null
    [k: string]: unknown
  }
  /**
   * 2-letter state code (e.g. NC), from gp-api's DistrictResolverService. Top-level and flat on purpose: the dispatch Lambda's scope derivation reads params.state to build the broker's auto-injected Residence_Addresses_State predicate, and reserves the top-level param name 'district' as a scope string (an object there fails dispatch). Present only together with the l2_district_* pair.
   */
  state?: string
}
export interface OpponentActionsArtifact {
  /**
   * Up to 5 distinct stand-out action cards, in threat order. Fewer when the field or platform supports fewer distinct angles; never padded.
   *
   * @minItems 0
   * @maxItems 5
   */
  actions:
    | []
    | [
        {
          /**
           * 2 short sentences (3 max), under 400 characters: lead with what the district's voters believe or lean on the issue (at most one Haystaq number, only when coverage exists), then the concrete contrast move against the opponent. Carries no statistic when coverage is missing.
           */
          body: string
          /**
           * The issue this card contrasts on. At most one card per opponent+issue pair.
           */
          issue: string
          /**
           * The input opponent this card contrasts against, echoed verbatim. Null only for an issue-ownership card the field's text supports without naming one opponent.
           */
          opponent_name: string | null
          /**
           * First-person candidate voice, plain factual contrast, sendable as-is. Only facts present in the input summaries and platform.
           */
          sms_message: string
          /**
           * Action-framed title naming the opponent and issue (e.g. 'Stand out against Jeff Groh on housing affordability').
           */
          title: string
        },
      ]
    | [
        {
          /**
           * 2 short sentences (3 max), under 400 characters: lead with what the district's voters believe or lean on the issue (at most one Haystaq number, only when coverage exists), then the concrete contrast move against the opponent. Carries no statistic when coverage is missing.
           */
          body: string
          /**
           * The issue this card contrasts on. At most one card per opponent+issue pair.
           */
          issue: string
          /**
           * The input opponent this card contrasts against, echoed verbatim. Null only for an issue-ownership card the field's text supports without naming one opponent.
           */
          opponent_name: string | null
          /**
           * First-person candidate voice, plain factual contrast, sendable as-is. Only facts present in the input summaries and platform.
           */
          sms_message: string
          /**
           * Action-framed title naming the opponent and issue (e.g. 'Stand out against Jeff Groh on housing affordability').
           */
          title: string
        },
        {
          /**
           * 2 short sentences (3 max), under 400 characters: lead with what the district's voters believe or lean on the issue (at most one Haystaq number, only when coverage exists), then the concrete contrast move against the opponent. Carries no statistic when coverage is missing.
           */
          body: string
          /**
           * The issue this card contrasts on. At most one card per opponent+issue pair.
           */
          issue: string
          /**
           * The input opponent this card contrasts against, echoed verbatim. Null only for an issue-ownership card the field's text supports without naming one opponent.
           */
          opponent_name: string | null
          /**
           * First-person candidate voice, plain factual contrast, sendable as-is. Only facts present in the input summaries and platform.
           */
          sms_message: string
          /**
           * Action-framed title naming the opponent and issue (e.g. 'Stand out against Jeff Groh on housing affordability').
           */
          title: string
        },
      ]
    | [
        {
          /**
           * 2 short sentences (3 max), under 400 characters: lead with what the district's voters believe or lean on the issue (at most one Haystaq number, only when coverage exists), then the concrete contrast move against the opponent. Carries no statistic when coverage is missing.
           */
          body: string
          /**
           * The issue this card contrasts on. At most one card per opponent+issue pair.
           */
          issue: string
          /**
           * The input opponent this card contrasts against, echoed verbatim. Null only for an issue-ownership card the field's text supports without naming one opponent.
           */
          opponent_name: string | null
          /**
           * First-person candidate voice, plain factual contrast, sendable as-is. Only facts present in the input summaries and platform.
           */
          sms_message: string
          /**
           * Action-framed title naming the opponent and issue (e.g. 'Stand out against Jeff Groh on housing affordability').
           */
          title: string
        },
        {
          /**
           * 2 short sentences (3 max), under 400 characters: lead with what the district's voters believe or lean on the issue (at most one Haystaq number, only when coverage exists), then the concrete contrast move against the opponent. Carries no statistic when coverage is missing.
           */
          body: string
          /**
           * The issue this card contrasts on. At most one card per opponent+issue pair.
           */
          issue: string
          /**
           * The input opponent this card contrasts against, echoed verbatim. Null only for an issue-ownership card the field's text supports without naming one opponent.
           */
          opponent_name: string | null
          /**
           * First-person candidate voice, plain factual contrast, sendable as-is. Only facts present in the input summaries and platform.
           */
          sms_message: string
          /**
           * Action-framed title naming the opponent and issue (e.g. 'Stand out against Jeff Groh on housing affordability').
           */
          title: string
        },
        {
          /**
           * 2 short sentences (3 max), under 400 characters: lead with what the district's voters believe or lean on the issue (at most one Haystaq number, only when coverage exists), then the concrete contrast move against the opponent. Carries no statistic when coverage is missing.
           */
          body: string
          /**
           * The issue this card contrasts on. At most one card per opponent+issue pair.
           */
          issue: string
          /**
           * The input opponent this card contrasts against, echoed verbatim. Null only for an issue-ownership card the field's text supports without naming one opponent.
           */
          opponent_name: string | null
          /**
           * First-person candidate voice, plain factual contrast, sendable as-is. Only facts present in the input summaries and platform.
           */
          sms_message: string
          /**
           * Action-framed title naming the opponent and issue (e.g. 'Stand out against Jeff Groh on housing affordability').
           */
          title: string
        },
      ]
    | [
        {
          /**
           * 2 short sentences (3 max), under 400 characters: lead with what the district's voters believe or lean on the issue (at most one Haystaq number, only when coverage exists), then the concrete contrast move against the opponent. Carries no statistic when coverage is missing.
           */
          body: string
          /**
           * The issue this card contrasts on. At most one card per opponent+issue pair.
           */
          issue: string
          /**
           * The input opponent this card contrasts against, echoed verbatim. Null only for an issue-ownership card the field's text supports without naming one opponent.
           */
          opponent_name: string | null
          /**
           * First-person candidate voice, plain factual contrast, sendable as-is. Only facts present in the input summaries and platform.
           */
          sms_message: string
          /**
           * Action-framed title naming the opponent and issue (e.g. 'Stand out against Jeff Groh on housing affordability').
           */
          title: string
        },
        {
          /**
           * 2 short sentences (3 max), under 400 characters: lead with what the district's voters believe or lean on the issue (at most one Haystaq number, only when coverage exists), then the concrete contrast move against the opponent. Carries no statistic when coverage is missing.
           */
          body: string
          /**
           * The issue this card contrasts on. At most one card per opponent+issue pair.
           */
          issue: string
          /**
           * The input opponent this card contrasts against, echoed verbatim. Null only for an issue-ownership card the field's text supports without naming one opponent.
           */
          opponent_name: string | null
          /**
           * First-person candidate voice, plain factual contrast, sendable as-is. Only facts present in the input summaries and platform.
           */
          sms_message: string
          /**
           * Action-framed title naming the opponent and issue (e.g. 'Stand out against Jeff Groh on housing affordability').
           */
          title: string
        },
        {
          /**
           * 2 short sentences (3 max), under 400 characters: lead with what the district's voters believe or lean on the issue (at most one Haystaq number, only when coverage exists), then the concrete contrast move against the opponent. Carries no statistic when coverage is missing.
           */
          body: string
          /**
           * The issue this card contrasts on. At most one card per opponent+issue pair.
           */
          issue: string
          /**
           * The input opponent this card contrasts against, echoed verbatim. Null only for an issue-ownership card the field's text supports without naming one opponent.
           */
          opponent_name: string | null
          /**
           * First-person candidate voice, plain factual contrast, sendable as-is. Only facts present in the input summaries and platform.
           */
          sms_message: string
          /**
           * Action-framed title naming the opponent and issue (e.g. 'Stand out against Jeff Groh on housing affordability').
           */
          title: string
        },
        {
          /**
           * 2 short sentences (3 max), under 400 characters: lead with what the district's voters believe or lean on the issue (at most one Haystaq number, only when coverage exists), then the concrete contrast move against the opponent. Carries no statistic when coverage is missing.
           */
          body: string
          /**
           * The issue this card contrasts on. At most one card per opponent+issue pair.
           */
          issue: string
          /**
           * The input opponent this card contrasts against, echoed verbatim. Null only for an issue-ownership card the field's text supports without naming one opponent.
           */
          opponent_name: string | null
          /**
           * First-person candidate voice, plain factual contrast, sendable as-is. Only facts present in the input summaries and platform.
           */
          sms_message: string
          /**
           * Action-framed title naming the opponent and issue (e.g. 'Stand out against Jeff Groh on housing affordability').
           */
          title: string
        },
      ]
    | [
        {
          /**
           * 2 short sentences (3 max), under 400 characters: lead with what the district's voters believe or lean on the issue (at most one Haystaq number, only when coverage exists), then the concrete contrast move against the opponent. Carries no statistic when coverage is missing.
           */
          body: string
          /**
           * The issue this card contrasts on. At most one card per opponent+issue pair.
           */
          issue: string
          /**
           * The input opponent this card contrasts against, echoed verbatim. Null only for an issue-ownership card the field's text supports without naming one opponent.
           */
          opponent_name: string | null
          /**
           * First-person candidate voice, plain factual contrast, sendable as-is. Only facts present in the input summaries and platform.
           */
          sms_message: string
          /**
           * Action-framed title naming the opponent and issue (e.g. 'Stand out against Jeff Groh on housing affordability').
           */
          title: string
        },
        {
          /**
           * 2 short sentences (3 max), under 400 characters: lead with what the district's voters believe or lean on the issue (at most one Haystaq number, only when coverage exists), then the concrete contrast move against the opponent. Carries no statistic when coverage is missing.
           */
          body: string
          /**
           * The issue this card contrasts on. At most one card per opponent+issue pair.
           */
          issue: string
          /**
           * The input opponent this card contrasts against, echoed verbatim. Null only for an issue-ownership card the field's text supports without naming one opponent.
           */
          opponent_name: string | null
          /**
           * First-person candidate voice, plain factual contrast, sendable as-is. Only facts present in the input summaries and platform.
           */
          sms_message: string
          /**
           * Action-framed title naming the opponent and issue (e.g. 'Stand out against Jeff Groh on housing affordability').
           */
          title: string
        },
        {
          /**
           * 2 short sentences (3 max), under 400 characters: lead with what the district's voters believe or lean on the issue (at most one Haystaq number, only when coverage exists), then the concrete contrast move against the opponent. Carries no statistic when coverage is missing.
           */
          body: string
          /**
           * The issue this card contrasts on. At most one card per opponent+issue pair.
           */
          issue: string
          /**
           * The input opponent this card contrasts against, echoed verbatim. Null only for an issue-ownership card the field's text supports without naming one opponent.
           */
          opponent_name: string | null
          /**
           * First-person candidate voice, plain factual contrast, sendable as-is. Only facts present in the input summaries and platform.
           */
          sms_message: string
          /**
           * Action-framed title naming the opponent and issue (e.g. 'Stand out against Jeff Groh on housing affordability').
           */
          title: string
        },
        {
          /**
           * 2 short sentences (3 max), under 400 characters: lead with what the district's voters believe or lean on the issue (at most one Haystaq number, only when coverage exists), then the concrete contrast move against the opponent. Carries no statistic when coverage is missing.
           */
          body: string
          /**
           * The issue this card contrasts on. At most one card per opponent+issue pair.
           */
          issue: string
          /**
           * The input opponent this card contrasts against, echoed verbatim. Null only for an issue-ownership card the field's text supports without naming one opponent.
           */
          opponent_name: string | null
          /**
           * First-person candidate voice, plain factual contrast, sendable as-is. Only facts present in the input summaries and platform.
           */
          sms_message: string
          /**
           * Action-framed title naming the opponent and issue (e.g. 'Stand out against Jeff Groh on housing affordability').
           */
          title: string
        },
        {
          /**
           * 2 short sentences (3 max), under 400 characters: lead with what the district's voters believe or lean on the issue (at most one Haystaq number, only when coverage exists), then the concrete contrast move against the opponent. Carries no statistic when coverage is missing.
           */
          body: string
          /**
           * The issue this card contrasts on. At most one card per opponent+issue pair.
           */
          issue: string
          /**
           * The input opponent this card contrasts against, echoed verbatim. Null only for an issue-ownership card the field's text supports without naming one opponent.
           */
          opponent_name: string | null
          /**
           * First-person candidate voice, plain factual contrast, sendable as-is. Only facts present in the input summaries and platform.
           */
          sms_message: string
          /**
           * Action-framed title naming the opponent and issue (e.g. 'Stand out against Jeff Groh on housing affordability').
           */
          title: string
        },
      ]
  generated_at: string
  /**
   * How the district sentiment step went: district_scoped when at least one card carries district Haystaq numbers; no_coverage when queries ran but no column survived the coverage rule and cell-size floor (or the district value never matched); no_district when the state/l2_district_* params were absent and Databricks was skipped entirely.
   */
  haystaq_status: 'district_scoped' | 'no_coverage' | 'no_district'
}
export interface OpponentDataCollectionInputParams {
  /**
   * The opponents to collect as-collected data for. Names are seeded by gp-api from campaignStrategyOpponent; the URL hints are optional and used as a starting point when present.
   *
   * @minItems 1
   */
  opponents: [
    {
      /**
       * Optional hint: the opponent's Ballotpedia page if gp-api already knows it. When present, use it directly; when null/absent, discover it via WebSearch.
       */
      ballotpedia_url?: string | null
      /**
       * The opponent's full name. Used both for source discovery via WebSearch and as the opponent_name on every emitted item.
       */
      full_name: string
      /**
       * Optional hint: the opponent's campaign website if gp-api already knows it. When present, use it directly; when null/absent, discover it via WebSearch.
       */
      website_url?: string | null
    },
    ...{
      /**
       * Optional hint: the opponent's Ballotpedia page if gp-api already knows it. When present, use it directly; when null/absent, discover it via WebSearch.
       */
      ballotpedia_url?: string | null
      /**
       * The opponent's full name. Used both for source discovery via WebSearch and as the opponent_name on every emitted item.
       */
      full_name: string
      /**
       * Optional hint: the opponent's campaign website if gp-api already knows it. When present, use it directly; when null/absent, discover it via WebSearch.
       */
      website_url?: string | null
    }[],
  ]
  /**
   * The race the opponents are running in, hydrated by gp-api before dispatch. Used only to disambiguate the right person/page during discovery (same office, jurisdiction, cycle). The agent does NOT reason over it beyond that.
   */
  race_context: {
    /**
     * City / jurisdiction name, or null.
     */
    city?: string | null
    /**
     * The election date for this race, or null. Used to confirm the right cycle during discovery.
     */
    election_date?: string | null
    /**
     * Readable office name (e.g. 'Fayetteville City Council').
     */
    office_name?: string | null
    /**
     * 2-letter state code (e.g. NC), or null.
     */
    state?: string | null
    [k: string]: unknown
  }
}
export interface OpponentDataCollectionArtifact {
  generated_at: string
  /**
   * One entry per (opponent, source) actually found and fetched. A source that could not be found or fetched is omitted entirely (never invented). An opponent with neither source contributes zero entries; the array may be empty if no source was fetched for any opponent.
   */
  items: {
    /**
     * Unstructured extracted page text/sections, as collected. Deliberately not normalized into named fields beyond `text` — that is a later-phase decision. Capture the page text as-is.
     */
    content: {
      /**
       * The full extracted page text/sections, as-is from the fetched page.
       */
      text: string
    }
    /**
     * The opponent this collected content is about. Matches one of the input opponents' full_name.
     */
    opponent_name: string
    /**
     * Which of the two sources this content came from.
     */
    source_type: 'ballotpedia' | 'opponent_website'
    /**
     * The page actually fetched (the broker's returned source_url after any redirect). Required — every item is grounded in a real fetched URL.
     */
    source_url: string
  }[]
}
export interface OpponentSummaryInputParams {
  /**
   * The candidate's own platform, hydrated by gp-api from Website.content.about (NOT CampaignStory). Used to rank threat tiers relative to the candidate and to pair each issue contrast against the candidate's own stance. Absent when the campaign has no website bio yet, in which case issue_contrasts are omitted (empty array).
   */
  candidate_platform?: {
    /**
     * The candidate's own biography paragraph, as captured for their candidate site.
     */
    bio?: string
    /**
     * The candidate's own issue positions. An issue contrast's candidate_stance is drawn only from these, never invented and never from CampaignStory.
     */
    issues?: {
      /**
       * The candidate's own stated stance on this issue.
       */
      description: string
      /**
       * Short issue title (e.g. 'Water security').
       */
      title: string
    }[]
  }
  /**
   * The opponents to structure, with the already-collected per-source text gp-api hydrated from race_opponent.content.text (Phase 0). This is the ONLY text the agent works from — there is no fetching or discovery.
   *
   * @minItems 1
   */
  opponents: [
    {
      /**
       * The opponent this collected text is about. Echoed verbatim as opponent_name on the matching output entry.
       */
      opponent_name: string
      /**
       * The already-collected sources for this opponent. May be empty when nothing was collected; an opponent with no sources contributes no groundable sections.
       */
      sources: {
        /**
         * Which collected source this text came from.
         */
        source_type: 'ballotpedia' | 'opponent_website'
        /**
         * The page this text was collected from. The ONLY URLs that may appear in any output section's sources are the source_url values present here.
         */
        source_url: string
        /**
         * The collected page text for this source, as captured in Phase 0. The agent structures THIS text and adds nothing not present in it.
         */
        text: string
      }[]
    },
    ...{
      /**
       * The opponent this collected text is about. Echoed verbatim as opponent_name on the matching output entry.
       */
      opponent_name: string
      /**
       * The already-collected sources for this opponent. May be empty when nothing was collected; an opponent with no sources contributes no groundable sections.
       */
      sources: {
        /**
         * Which collected source this text came from.
         */
        source_type: 'ballotpedia' | 'opponent_website'
        /**
         * The page this text was collected from. The ONLY URLs that may appear in any output section's sources are the source_url values present here.
         */
        source_url: string
        /**
         * The collected page text for this source, as captured in Phase 0. The agent structures THIS text and adds nothing not present in it.
         */
        text: string
      }[]
    }[],
  ]
  /**
   * The race the opponents are running in, hydrated by gp-api. Light context for phrasing only (office / jurisdiction). The agent does NOT reason over it to add facts and never cites it.
   */
  race_context: {
    /**
     * City / jurisdiction name, or null.
     */
    city?: string | null
    /**
     * The election date for this race, or null.
     */
    election_date?: string | null
    /**
     * Readable office name (e.g. 'Fayetteville City Council').
     */
    office_name?: string | null
    /**
     * 2-letter state code (e.g. NC), or null.
     */
    state?: string | null
    [k: string]: unknown
  }
}
export interface OpponentSummaryArtifact {
  /**
   * Campaign-level SWOT. Bullets are interpretive syntheses across the whole field and carry no required source; sources may be empty.
   */
  field_analysis: {
    /**
     * Short bullets, up to 5, only as many as the field genuinely supports.
     */
    opportunities: string[]
    /**
     * Optional citations. Empty unless a bullet rests directly on a specific cited claim worth pinning down.
     */
    sources: {
      /**
       * Optional. One sentence on what the source is, derived from the page's own content.
       */
      description?: string
      /**
       * The site/org name, derived from the page's own content and source type (e.g. 'Ballotpedia', a campaign/org name the page names). Falls back to the bare hostname of url when the text names no organization.
       */
      publisher: string
      /**
       * The cited page/document's human title, derived from the page's own content and source type. Falls back to a generic title (e.g. 'Ballotpedia profile') when the text names none.
       */
      title: string
      /**
       * Verbatim one of that opponent's input source_urls. Never invented, never cross-opponent, never race_context or candidate_platform.
       */
      url: string
    }[]
    /**
     * Short bullets, up to 5, only as many as the field genuinely supports.
     */
    strengths: string[]
    /**
     * Short bullets, up to 5, only as many as the field genuinely supports.
     */
    threats: string[]
    /**
     * Short bullets, up to 5, only as many as the field genuinely supports.
     */
    weaknesses: string[]
  } | null
  generated_at: string
  /**
   * One entry per input opponent, in input order. opponent_name echoes the input verbatim. Descriptive sections (overview, background, issues_that_matter) are sourced-or-silent: null when the provided text supports none, otherwise carrying >=1 rich source drawn from that opponent's input source_urls. threat_tier and why_theyre_running are interpretive and carry no source.
   *
   * @minItems 1
   */
  opponents: [
    {
      /**
       * Sourced-or-silent: a descriptive paragraph drawn only from the provided text (overview: short who-they-are; background: career/community ties/prior roles), or null when the text supports none. Used for both overview and background.
       */
      background?: {
        /**
         * One or more rich sources this text was drawn from, verbatim from that opponent's input source_urls.
         *
         * @minItems 1
         */
        sources: [
          {
            /**
             * Optional. One sentence on what the source is, derived from the page's own content.
             */
            description?: string
            /**
             * The site/org name, derived from the page's own content and source type (e.g. 'Ballotpedia', a campaign/org name the page names). Falls back to the bare hostname of url when the text names no organization.
             */
            publisher: string
            /**
             * The cited page/document's human title, derived from the page's own content and source type. Falls back to a generic title (e.g. 'Ballotpedia profile') when the text names none.
             */
            title: string
            /**
             * Verbatim one of that opponent's input source_urls. Never invented, never cross-opponent, never race_context or candidate_platform.
             */
            url: string
          },
          ...{
            /**
             * Optional. One sentence on what the source is, derived from the page's own content.
             */
            description?: string
            /**
             * The site/org name, derived from the page's own content and source type (e.g. 'Ballotpedia', a campaign/org name the page names). Falls back to the bare hostname of url when the text names no organization.
             */
            publisher: string
            /**
             * The cited page/document's human title, derived from the page's own content and source type. Falls back to a generic title (e.g. 'Ballotpedia profile') when the text names none.
             */
            title: string
            /**
             * Verbatim one of that opponent's input source_urls. Never invented, never cross-opponent, never race_context or candidate_platform.
             */
            url: string
          }[],
        ]
        text: string
      } | null
      issues_that_matter?: {
        /**
         * Short bullet strings capturing the issues/themes the opponent's own text emphasizes.
         *
         * @minItems 1
         */
        items: [string, ...string[]]
        /**
         * One or more rich sources shared across the section, verbatim from that opponent's input source_urls.
         *
         * @minItems 1
         */
        sources: [
          {
            /**
             * Optional. One sentence on what the source is, derived from the page's own content.
             */
            description?: string
            /**
             * The site/org name, derived from the page's own content and source type (e.g. 'Ballotpedia', a campaign/org name the page names). Falls back to the bare hostname of url when the text names no organization.
             */
            publisher: string
            /**
             * The cited page/document's human title, derived from the page's own content and source type. Falls back to a generic title (e.g. 'Ballotpedia profile') when the text names none.
             */
            title: string
            /**
             * Verbatim one of that opponent's input source_urls. Never invented, never cross-opponent, never race_context or candidate_platform.
             */
            url: string
          },
          ...{
            /**
             * Optional. One sentence on what the source is, derived from the page's own content.
             */
            description?: string
            /**
             * The site/org name, derived from the page's own content and source type (e.g. 'Ballotpedia', a campaign/org name the page names). Falls back to the bare hostname of url when the text names no organization.
             */
            publisher: string
            /**
             * The cited page/document's human title, derived from the page's own content and source type. Falls back to a generic title (e.g. 'Ballotpedia profile') when the text names none.
             */
            title: string
            /**
             * Verbatim one of that opponent's input source_urls. Never invented, never cross-opponent, never race_context or candidate_platform.
             */
            url: string
          }[],
        ]
      } | null
      /**
       * Matches an input opponent's opponent_name verbatim.
       */
      opponent_name: string
      /**
       * Sourced-or-silent: a descriptive paragraph drawn only from the provided text (overview: short who-they-are; background: career/community ties/prior roles), or null when the text supports none. Used for both overview and background.
       */
      overview?: {
        /**
         * One or more rich sources this text was drawn from, verbatim from that opponent's input source_urls.
         *
         * @minItems 1
         */
        sources: [
          {
            /**
             * Optional. One sentence on what the source is, derived from the page's own content.
             */
            description?: string
            /**
             * The site/org name, derived from the page's own content and source type (e.g. 'Ballotpedia', a campaign/org name the page names). Falls back to the bare hostname of url when the text names no organization.
             */
            publisher: string
            /**
             * The cited page/document's human title, derived from the page's own content and source type. Falls back to a generic title (e.g. 'Ballotpedia profile') when the text names none.
             */
            title: string
            /**
             * Verbatim one of that opponent's input source_urls. Never invented, never cross-opponent, never race_context or candidate_platform.
             */
            url: string
          },
          ...{
            /**
             * Optional. One sentence on what the source is, derived from the page's own content.
             */
            description?: string
            /**
             * The site/org name, derived from the page's own content and source type (e.g. 'Ballotpedia', a campaign/org name the page names). Falls back to the bare hostname of url when the text names no organization.
             */
            publisher: string
            /**
             * The cited page/document's human title, derived from the page's own content and source type. Falls back to a generic title (e.g. 'Ballotpedia profile') when the text names none.
             */
            title: string
            /**
             * Verbatim one of that opponent's input source_urls. Never invented, never cross-opponent, never race_context or candidate_platform.
             */
            url: string
          }[],
        ]
        text: string
      } | null
      /**
       * This opponent's threat level ranked RELATIVE to the whole field and the candidate (incumbency, endorsements/PAC backing, name recognition, overlap with the candidate's own issues). Exactly one realistic primary_threat for a normal field. Interpretive: carries no source.
       */
      threat_tier: 'primary_threat' | 'watch_closely' | 'low_priority'
      /**
       * Interpretive: no sources property exists on this shape.
       */
      why_theyre_running?: {
        text: string
      } | null
    },
    ...{
      /**
       * Sourced-or-silent: a descriptive paragraph drawn only from the provided text (overview: short who-they-are; background: career/community ties/prior roles), or null when the text supports none. Used for both overview and background.
       */
      background?: {
        /**
         * One or more rich sources this text was drawn from, verbatim from that opponent's input source_urls.
         *
         * @minItems 1
         */
        sources: [
          {
            /**
             * Optional. One sentence on what the source is, derived from the page's own content.
             */
            description?: string
            /**
             * The site/org name, derived from the page's own content and source type (e.g. 'Ballotpedia', a campaign/org name the page names). Falls back to the bare hostname of url when the text names no organization.
             */
            publisher: string
            /**
             * The cited page/document's human title, derived from the page's own content and source type. Falls back to a generic title (e.g. 'Ballotpedia profile') when the text names none.
             */
            title: string
            /**
             * Verbatim one of that opponent's input source_urls. Never invented, never cross-opponent, never race_context or candidate_platform.
             */
            url: string
          },
          ...{
            /**
             * Optional. One sentence on what the source is, derived from the page's own content.
             */
            description?: string
            /**
             * The site/org name, derived from the page's own content and source type (e.g. 'Ballotpedia', a campaign/org name the page names). Falls back to the bare hostname of url when the text names no organization.
             */
            publisher: string
            /**
             * The cited page/document's human title, derived from the page's own content and source type. Falls back to a generic title (e.g. 'Ballotpedia profile') when the text names none.
             */
            title: string
            /**
             * Verbatim one of that opponent's input source_urls. Never invented, never cross-opponent, never race_context or candidate_platform.
             */
            url: string
          }[],
        ]
        text: string
      } | null
      issues_that_matter?: {
        /**
         * Short bullet strings capturing the issues/themes the opponent's own text emphasizes.
         *
         * @minItems 1
         */
        items: [string, ...string[]]
        /**
         * One or more rich sources shared across the section, verbatim from that opponent's input source_urls.
         *
         * @minItems 1
         */
        sources: [
          {
            /**
             * Optional. One sentence on what the source is, derived from the page's own content.
             */
            description?: string
            /**
             * The site/org name, derived from the page's own content and source type (e.g. 'Ballotpedia', a campaign/org name the page names). Falls back to the bare hostname of url when the text names no organization.
             */
            publisher: string
            /**
             * The cited page/document's human title, derived from the page's own content and source type. Falls back to a generic title (e.g. 'Ballotpedia profile') when the text names none.
             */
            title: string
            /**
             * Verbatim one of that opponent's input source_urls. Never invented, never cross-opponent, never race_context or candidate_platform.
             */
            url: string
          },
          ...{
            /**
             * Optional. One sentence on what the source is, derived from the page's own content.
             */
            description?: string
            /**
             * The site/org name, derived from the page's own content and source type (e.g. 'Ballotpedia', a campaign/org name the page names). Falls back to the bare hostname of url when the text names no organization.
             */
            publisher: string
            /**
             * The cited page/document's human title, derived from the page's own content and source type. Falls back to a generic title (e.g. 'Ballotpedia profile') when the text names none.
             */
            title: string
            /**
             * Verbatim one of that opponent's input source_urls. Never invented, never cross-opponent, never race_context or candidate_platform.
             */
            url: string
          }[],
        ]
      } | null
      /**
       * Matches an input opponent's opponent_name verbatim.
       */
      opponent_name: string
      /**
       * Sourced-or-silent: a descriptive paragraph drawn only from the provided text (overview: short who-they-are; background: career/community ties/prior roles), or null when the text supports none. Used for both overview and background.
       */
      overview?: {
        /**
         * One or more rich sources this text was drawn from, verbatim from that opponent's input source_urls.
         *
         * @minItems 1
         */
        sources: [
          {
            /**
             * Optional. One sentence on what the source is, derived from the page's own content.
             */
            description?: string
            /**
             * The site/org name, derived from the page's own content and source type (e.g. 'Ballotpedia', a campaign/org name the page names). Falls back to the bare hostname of url when the text names no organization.
             */
            publisher: string
            /**
             * The cited page/document's human title, derived from the page's own content and source type. Falls back to a generic title (e.g. 'Ballotpedia profile') when the text names none.
             */
            title: string
            /**
             * Verbatim one of that opponent's input source_urls. Never invented, never cross-opponent, never race_context or candidate_platform.
             */
            url: string
          },
          ...{
            /**
             * Optional. One sentence on what the source is, derived from the page's own content.
             */
            description?: string
            /**
             * The site/org name, derived from the page's own content and source type (e.g. 'Ballotpedia', a campaign/org name the page names). Falls back to the bare hostname of url when the text names no organization.
             */
            publisher: string
            /**
             * The cited page/document's human title, derived from the page's own content and source type. Falls back to a generic title (e.g. 'Ballotpedia profile') when the text names none.
             */
            title: string
            /**
             * Verbatim one of that opponent's input source_urls. Never invented, never cross-opponent, never race_context or candidate_platform.
             */
            url: string
          }[],
        ]
        text: string
      } | null
      /**
       * This opponent's threat level ranked RELATIVE to the whole field and the candidate (incumbency, endorsements/PAC backing, name recognition, overlap with the candidate's own issues). Exactly one realistic primary_threat for a normal field. Interpretive: carries no source.
       */
      threat_tier: 'primary_threat' | 'watch_closely' | 'low_priority'
      /**
       * Interpretive: no sources property exists on this shape.
       */
      why_theyre_running?: {
        text: string
      } | null
    }[],
  ]
}
export interface SelfResearchInputParams {
  /**
   * City / jurisdiction name, or null. Used to disambiguate the right person during discovery.
   */
  city?: string | null
  /**
   * Optional hints: known news-coverage URLs about the candidate. Used as starting points; the agent still discovers more via WebSearch.
   */
  coverage_urls?: string[]
  /**
   * The candidate's full name. The person this research is FOR. Used for source discovery via WebSearch and to confirm a fetched page is about this candidate, not a same-named person.
   */
  full_name: string
  /**
   * Readable office the candidate is running for (e.g. 'Fayetteville City Council'). Disambiguates the right race during discovery.
   */
  office_name: string
  /**
   * Prior public roles / offices the candidate has held (e.g. 'School Board Member 2018-2022'), to seed record and statements research. Optional; may be empty.
   */
  prior_roles?: string[]
  /**
   * Optional hints: the candidate's public social-media profile URLs. Used as starting points for the public footprint.
   */
  social_urls?: string[]
  /**
   * 2-letter state code (e.g. NC). Used to disambiguate the right person/jurisdiction during discovery.
   */
  state: string
  /**
   * Optional hint: the candidate's campaign website. When present, fetch it directly; when null/absent, discover via WebSearch.
   */
  website_url?: string | null
}
export interface SelfResearchArtifact {
  /**
   * One entry per verified vulnerability in the candidate's own public record. A finding is emitted ONLY when its source_extract literally appears on the fetched source_url. Findings that fail verification are dropped, never invented. The array may be empty when nothing surfaced.
   */
  findings: {
    /**
     * Which vulnerability category this finding belongs to.
     */
    category:
      | 'residency'
      | 'record'
      | 'statements'
      | 'funding'
      | 'conflicts'
      | 'narrative'
    /**
     * The vulnerability stated plainly: what an opponent could attack the candidate on, grounded in the candidate's own public conduct.
     */
    claim: string
    /**
     * A short, ready-to-use response the candidate could give if attacked on this. First person or neutral; honest, not spin.
     */
    drafted_response: string
    /**
     * Optional date the underlying event occurred (not the retrieval date), or null when undated.
     */
    occurred_at?: string | null
    /**
     * A verbatim passage from the fetched page that substantiates the claim. MUST appear literally on source_url (verified via verify_quote).
     */
    source_extract: string
    /**
     * Optional human-readable title of the source page.
     */
    source_title?: string
    /**
     * The page actually fetched (the broker's returned X-Source-URL after any redirect). Every finding is grounded in a real fetched URL.
     */
    source_url: string
  }[]
  generated_at: string
}
export interface TopCommunityIssuesOutput {
  data_quality: 'ok' | 'partial' | 'insufficient_signal'
  data_quality_reason?: string
  generated_for_run_id: string
  /**
   * @maxItems 5
   */
  issues:
    | []
    | [
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
      ]
    | [
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
      ]
    | [
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
      ]
    | [
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
      ]
    | [
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
      ]
  list: 'top_community'
  notes?: string
  organization_slug: string
  schema_version: 1
  sources_used?: string[]
}
export interface TrendingIssuesOutput {
  data_quality: 'ok' | 'partial' | 'insufficient_signal'
  data_quality_reason?: string
  generated_for_run_id: string
  /**
   * @maxItems 5
   */
  issues:
    | []
    | [
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
      ]
    | [
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
      ]
    | [
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
      ]
    | [
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
      ]
    | [
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
        {
          category:
            | 'infrastructure_and_transportation'
            | 'public_safety'
            | 'education'
            | 'housing_and_development'
            | 'health_and_human_services'
            | 'economic_development'
            | 'quality_of_life'
            | 'government_operations'
            | 'other'
          detail: {
            history?: {
              source_ids: string[]
              summary: string
            }
            legislation?: {
              source_ids: string[]
              summary: string
            }
            overview: {
              source_ids: string[]
              summary: string
            }
            quotes?: {
              items: {
                attribution?: string
                source_id: string
                text: string
              }[]
            }
            research?: {
              source_ids: string[]
              summary: string
            }
            sources: {
              article_date?: string | null
              article_type?:
                | 'reporting'
                | 'opinion'
                | 'editorial'
                | 'press_release'
                | 'government_communication'
                | null
              id: string
              name: string
              publisher?: string | null
              retrieved_at: string
              retrieved_text_or_snapshot: string
              source_type:
                | 'news'
                | 'government_website'
                | 'research'
                | 'poll'
                | 'advocacy_org'
              url?: string | null
            }[]
          }
          /**
           * ID of the existing community issue in the feed, if this issue already exists.
           */
          existing_issue_id?: string
          priority: 'low' | 'medium' | 'high'
          rank: number
          summary: string
          title: string
        },
      ]
  list: 'trending'
  notes?: string
  organization_slug: string
  schema_version: 1
  sources_used?: string[]
}
