// The product map's tree: products -> areas -> flows and pages -> steps, with the events
// that fire on each step. Inlined only into the product map build, which renders the
// explorer template with this in place of the events table, so the map page carries
// the explorer's search, filters and cards and its own tree. It reads the page's
// `DATA.events` (the explorer snapshot), `DATA.map.anchor_state` from build.py, and the
// shared `EventCard`, `USAGE` from the page.
var ProductMap = (function () {
  'use strict'
  // One row per event, from the same snapshot the cards render, so a step's status and
  // volume can never disagree with the card that opens under it. Positional because the
  // renderers below were written against the seeded rows:
  // [status, count_30d, count_total, series, url, description, fires_on, pr,
  //  instrumented_date, last_seen, anchor_state, (unused), display_name if it differs]
  const EV = {}
  ;(DATA.events || []).forEach((e) => {
    const p = e.provenance || {}
    EV[e.event_type] = [
      e.status,
      e.count_30d,
      e.count_total,
      e.series,
      e.url,
      e.description,
      e.fires_on,
      (p.instrumented_pr || '').replace(/\/+$/, '').split('/').pop(),
      p.instrumented_date || '',
      e.last_seen,
      (DATA.map.anchor_state || {})[e.event_type] || 'none',
      0,
      e.display_name !== e.event_type ? e.display_name : '',
    ]
  })

  const WIN_ONBOARDING = {
    kind: 'flow',
    name: 'Win onboarding',
    route: '/onboarding/[slug]/[step]',
    src: 'packages/gp-webapp/app/onboarding/components/onboardingConfig.ts',
    note: 'declared as ONBOARDING_STEPS; two of them are a fork on how the office was chosen',
    head: [
      {
        id: 'welcome',
        t: "Let's build your winning campaign plan in 5 minutes",
        state: 'ok',
        evs: [
          'Onboarding V2 - Welcome Viewed',
          'Onboarding V2 - Welcome Completed',
        ],
      },
      {
        id: 'ballot-status',
        t: 'Are you already on the ballot?',
        state: 'ok',
        evs: [
          'Onboarding V2 - Ballot Status Viewed',
          'Onboarding V2 - Ballot Status Completed',
        ],
      },
      {
        id: 'party-affiliation',
        t: 'Are you running with an official party designation?',
        state: 'ok',
        evs: [
          'Onboarding V2 - Party Designation Viewed',
          'Onboarding V2 - Party Designation Completed',
          'Onboarding V2 - Party Designation Blocked',
        ],
      },
      {
        id: 'office-selection',
        t: 'What office are you running for?',
        state: 'overlap',
        rec: ['2026-09-24', 5, 3],
        evs: [
          'Onboarding V2 - Office Viewed',
          'Onboarding V2 - Office Next Clicked',
          'Onboarding V2 - Office Completed',
          'Onboarding - Candidate Office Searched',
          'Onboarding - Office Step: Office Selected',
          'Onboarding - Candidate Office Completed',
          "Onboarding - Office Step: Click Can't See Office",
          'Onboarding - Office Step: Click Next',
        ],
        legacy: 'Onboarding - ',
        note: [
          'drift',
          'Two generations',
          'Five legacy <b>Onboarding - …</b> events still fire on this step alongside the V2 set. Everywhere else in this flow the legacy generation is retired.',
        ],
      },
    ],
    branch: {
      key: 'answers.officePath',
      rejoin: 'campaign-story-why',
      left: {
        cond: "shouldSkip: officePath !== 'manual'",
        step: {
          id: 'manual-office-entry',
          t: 'Tell us about your office',
          state: 'anchorgap',
          rec: ['2026-09-04', 1, 1],
          evs: ['Onboarding V2 - Manual Office Viewed'],
          note: [
            'warn',
            'No anchor',
            'Active in the registry, absent from <b>event_anchors.json</b>. The step is instrumented; the anchor pipeline does not know where it fires.',
          ],
        },
      },
      right: {
        cond: "shouldSkip: officePath === 'manual'",
        step: {
          id: 'path-to-victory',
          t: 'Projected votes needed to win',
          state: 'ok',
          evs: [
            'Onboarding V2 - Votes Needed Viewed',
            'Onboarding V2 - Votes Needed Calculated',
            'Onboarding V2 - Votes Needed Completed',
            'Onboarding V2 - Votes Needed Failed',
          ],
        },
      },
    },
    tail: [
      {
        id: 'campaign-story-why',
        t: 'Why are you running?',
        state: 'ok',
        evs: [
          'Onboarding V2 - Why Are You Running Viewed',
          'Onboarding V2 - Why Are You Running Completed',
        ],
      },
      {
        id: 'campaign-story-background',
        t: "What's your background?",
        state: 'ok',
        evs: [
          "Onboarding V2 - What's Your Background Viewed",
          "Onboarding V2 - What's Your Background Completed",
        ],
      },
      {
        id: 'campaign-story-issues',
        t: 'What issues do you most want to solve if elected?',
        state: 'ok',
        evs: [
          'Onboarding V2 - What Issues Do You Want To Solve Viewed',
          'Onboarding V2 - What Issues Do You Want To Solve Completed',
        ],
      },
      {
        id: 'signup-goal',
        t: 'What do you most want help with?',
        state: 'anchorgap',
        evs: [
          'Onboarding V2 - Signup Goal Viewed',
          'Onboarding V2 - Signup Goal Completed',
        ],
        note: [
          'warn',
          'No anchor',
          'Both events are active and both were instrumented this month. Neither is in <b>event_anchors.json</b>, so this step reads as a hole in any anchor-derived map.',
        ],
      },
      {
        id: 'pledge',
        t: 'Take our pledge to get your campaign plan',
        state: 'ok',
        rec: ['2026-07-16', 1, 1],
        evs: [
          'Onboarding V2 - Pledge Viewed',
          'Onboarding V2 - Pledge Submit Clicked',
          'Onboarding V2 - Pledge Completed',
        ],
      },
    ],
  }

  const SMS_WIZARD = {
    kind: 'flow',
    name: 'SMS outreach wizard',
    route: '/dashboard/outreach',
    src: 'packages/gp-webapp/app/dashboard/outreach/v2/sms/SmsFlow.tsx + OutreachFlowShell.tsx',
    note: 'five steps behind one route, instrumented by a property rather than by name',
    intro: [
      'warn',
      'One event pair covers every step',
      'This flow fires no event of its own. <b>OutreachFlowShell</b> fires <b>Voter Outreach - Flow Step Viewed</b> and <b>Flow Step Completed</b> for all four channel wizards, carrying <code>channel</code> and <code>step</code> as properties. So every step here is instrumented, but no step has an event named after it, and the snapshot holds event-level totals only — per-step volume needs a property breakdown in Amplitude. A map that matched steps to event names would have called all five of these uninstrumented.',
    ],
    steps: [
      {
        id: 'purpose',
        t: 'What is this message for?',
        state: 'shared',
        evs: [],
        shared: [
          ['Voter Outreach - Flow Step Viewed', 'purpose'],
          ['Voter Outreach - Flow Step Completed', 'purpose'],
        ],
      },
      {
        id: 'audience',
        t: 'Who should receive it?',
        state: 'shared',
        evs: [],
        shared: [
          ['Voter Outreach - Flow Step Viewed', 'audience'],
          ['Voter Outreach - Flow Step Completed', 'audience'],
        ],
      },
      {
        id: 'schedule',
        t: 'When should it send?',
        state: 'shared',
        evs: [],
        shared: [
          ['Voter Outreach - Flow Step Viewed', 'schedule'],
          ['Voter Outreach - Flow Step Completed', 'schedule'],
        ],
      },
      {
        id: 'compose',
        t: 'Write the message',
        state: 'shared',
        evs: [],
        shared: [
          ['Voter Outreach - Flow Step Viewed', 'compose'],
          ['Voter Outreach - Flow Step Completed', 'compose'],
        ],
      },
      {
        id: 'review',
        t: 'Review and send',
        state: 'shared',
        evs: [],
        shared: [
          ['Voter Outreach - Flow Step Viewed', 'review'],
          ['Voter Outreach - Flow Step Completed', 'review'],
        ],
      },
    ],
    offstep: {
      title: 'The hub this wizard opens from',
      evs: [
        'Outreach - View Accessed',
        'Outreach - Click Create',
        'Pro Upgrade - Locked Item: Click',
        'Voter Outreach - 10DLC Compliance Modal Viewed',
        'Voter Outreach - 10DLC Compliance Started',
      ],
    },
  }

  const DASHBOARD = {
    kind: 'page',
    name: 'Campaign Manager',
    route: '/dashboard',
    src: 'packages/gp-webapp/app/dashboard (many components)',
    note: 'not a flow — one screen of banners, modals and panels that appear conditionally',
    intro: [
      'drift',
      'A page is not a sequence',
      'Seventeen events are anchored to the single route <b>/dashboard</b>, from six different naming families. There is no step 3 here, so the nodes below are <b>zones</b> — the banner, the modal, the panel a person actually sees — grouped from each event’s own <code>fires_on</code> sentence. Nothing in the code declares these zones, which is the honest weakness of this view: for a page the grouping is inferred, not read.',
    ],
    zones: [
      {
        id: 'pro-upgrade-banner',
        t: 'Pro upgrade banner',
        state: 'ok',
        evs: [
          'Pro Upgrade - Banner Viewed',
          'Pro Upgrade - Banner: Click Get Pro',
        ],
      },
      {
        id: 'pro-upgrade-modal',
        t: 'Pro upgrade modal',
        state: 'ok',
        evs: [
          'Pro Upgrade - Modal: Modal Shown',
          'Pro Upgrade - Modal: Click Button',
          'Pro Upgrade - Modal: Exit',
        ],
      },
      {
        id: 'texting-setup-banner',
        t: 'Finish your texting setup banner',
        state: 'ok',
        evs: [
          'Pro Upgrade - Texting Setup Banner Viewed',
          'Pro Upgrade - Texting Setup Banner: Click Start',
        ],
      },
      {
        id: 'p2p-upgrade-modal',
        t: 'Peer-to-peer upgrade modal',
        state: 'ok',
        evs: [
          'P2P Upgrade - Modal: Modal Shown',
          'P2P Upgrade - Modal: Click Button',
        ],
      },
      {
        id: 'path-to-victory-modal',
        t: 'Path to Victory info modal',
        state: 'ok',
        evs: ['Dashboard - Path to Victory: Exit Understand Path to Victory'],
        note: [
          'warn',
          'Exit only',
          'The only event on this zone fires when the modal closes. Nothing records it opening, so the close count has no denominator.',
        ],
      },
      {
        id: 'task-recording',
        t: 'Recording voter contacts',
        state: 'ok',
        evs: ['Voter Outreach - Campaign Completed'],
      },
      {
        id: 'committee-check',
        t: 'Committee / EIN check',
        state: 'ok',
        evs: ['Pro Upgrade - Committee Check Page: Hover "EIN number" help'],
      },
    ],
    unplaced: {
      title: 'Five events anchored here that say they fire somewhere else',
      body: 'Each of these is anchored to <b>/dashboard</b>, and each one’s own <code>fires_on</code> sentence puts it in Contacts CRM — a different area at <b>/dashboard/contacts/crm</b>. The anchor and the anchor’s own prose disagree, which is a cheap check nothing currently runs.',
      evs: [
        'Contacts - List Wizard Method Viewed',
        'Contacts - List Wizard Conditions Viewed',
        'Contacts - Segment Viewed',
        'Voter Data - Contact Viewed',
        'Voter Data - Send Outreach Clicked',
      ],
    },
  }

  const SERVE_ONBOARDING = {
    kind: 'flow',
    name: 'Serve onboarding',
    route: '/serve/onboarding',
    src: 'packages/gp-webapp/app/serve/onboarding/serveOnboardingConfig.ts',
    note: 'two branches on whether the office record is already prefilled; they share the first three steps and the last two',
    head: [
      {
        id: 'welcome',
        t: 'Welcome',
        state: 'ok',
        evs: ['Serve Onboarding - Welcome Viewed'],
      },
      {
        id: 'inOffice',
        t: 'Are you currently in office?',
        state: 'ok',
        evs: ['Serve Onboarding - Office Status Viewed'],
        note: [
          'drift',
          'Name gap',
          'The step is <b>inOffice</b>; the event is <b>Office Status Viewed</b>. Neither is wrong, but you cannot search from one to the other.',
        ],
      },
      {
        id: 'party',
        t: 'Party designation',
        state: 'ok',
        evs: [
          'Serve Onboarding - Party Designation Viewed',
          'Serve Onboarding - Party Designation Blocked',
        ],
      },
    ],
    branch: {
      key: 'ServeBranch',
      rejoin: 'constituents',
      left: {
        cond: "branch === 'prefill'",
        step: {
          id: 'confirm',
          t: 'Confirm what we already know',
          state: 'ok',
          evs: ['Serve Onboarding - Confirm Viewed'],
        },
      },
      right: {
        cond: "branch === 'net-new'",
        step: {
          id: 'office + term-dates',
          t: 'Office, then term dates',
          state: 'ok',
          evs: [
            'Serve Onboarding - Office Viewed',
            'Serve Onboarding - Office Completed',
            'Serve Onboarding - Term Dates Viewed',
          ],
        },
      },
    },
    tail: [
      {
        id: 'constituents',
        t: 'Know your constituents',
        state: 'ok',
        evs: [
          'Serve Onboarding - Know Your Constituents Viewed',
          'Serve Onboarding - Know Your Constituents Completed',
        ],
      },
      {
        id: 'pledge',
        t: 'Take the pledge',
        state: 'ok',
        evs: [
          'Serve Onboarding - Pledge Viewed',
          'Serve Onboarding - Pledge Completed',
        ],
      },
    ],
  }

  const POLL_ONBOARDING = {
    kind: 'flow',
    name: 'Poll onboarding',
    route: '/polls/onboarding',
    src: 'packages/gp-webapp/app/polls/onboarding/components/OnboardingPage.tsx',
    note: 'seven steps declared as a linked list with nextStep / backStep; no branches',
    intro: [
      'drift',
      'Every event here is labelled for a different flow',
      'All nine live events in this flow display as <b>Serve Onboarding - …</b>, but this is not Serve onboarding — that is a separate seven-step flow at <b>/serve/onboarding</b> with its own events. The two were one flow once; the surface moved and the labels stayed. Anyone filtering to <b>Serve Onboarding</b> gets both flows mixed together with no way to tell them apart.',
    ],
    steps: [
      {
        id: 'Insights',
        t: 'Your constituency profile',
        state: 'ok',
        evs: ['Serve Onboarding - Constituency Profile Viewed'],
        note: [
          'drift',
          'Name gap',
          'The step is <b>Insights</b>; the event is <b>Constituency Profile Viewed</b>.',
        ],
      },
      {
        id: 'Sworn In',
        t: 'When were you sworn in?',
        state: 'ok',
        evs: [
          'Serve Onboarding - Sworn In Viewed',
          'Serve Onboarding - Sworn In Completed',
        ],
      },
      {
        id: 'Outreach Prelude',
        t: 'Why reach out to constituents',
        state: 'ok',
        evs: ['Serve Onboarding - Poll Value Props Viewed'],
        note: [
          'drift',
          'Name gap',
          'The step is <b>Outreach Prelude</b>; the event is <b>Poll Value Props Viewed</b>.',
        ],
      },
      {
        id: 'Strategy',
        t: 'Your free introductory poll',
        state: 'ok',
        evs: ['Serve Onboarding - Poll Strategy Viewed'],
      },
      {
        id: 'Pick Send Date',
        t: 'When should the poll go out?',
        state: 'none',
        evs: [],
        empty: {
          src: 'packages/gp-webapp/app/polls/onboarding/components/steps/PickSendDateStep.tsx',
          why: 'Step 5 of 7 in a live flow. No <code>trackEvent</code> call in the component, nothing in the EVENTS registry matching a send date, and no event anchored to this step. Every step around it fires a Viewed event, so the drop-off between Strategy and Add Image cannot be attributed.',
        },
      },
      {
        id: 'Add Image',
        t: 'Add an image to your poll',
        state: 'ok',
        evs: ['Serve Onboarding - Add Image Viewed'],
      },
      {
        id: 'Preview',
        t: 'Preview and send',
        state: 'ok',
        evs: ['Serve Onboarding - Poll Preview Viewed'],
      },
    ],
    offstep: {
      title: 'Reached from this flow, outside the stepper',
      evs: [
        'Serve Onboarding - Getting Started Viewed',
        'Serve Onboarding - Meet Your Constituents Viewed',
        'Serve Onboarding - SMS Poll Sent',
        'Serve Onboarding - SMS Poll Creation Failed',
        'Serve Onboarding - Poll Image Uploaded',
        'Serve Onboarding - Success Page Viewed',
      ],
    },
    relabel: {
      title: 'Relabel candidates',
      body: 'Nine events whose <b>display name</b> says Serve onboarding and whose route says poll onboarding. Changing a display name is a label change: it costs nothing, breaks nothing, and is reversible, because every saved chart, cohort and dbt model filters on the event type underneath, which does not move.',
      pairs: [
        [
          'Serve Onboarding - Getting Started Viewed',
          'Poll Onboarding - Getting Started Viewed',
        ],
        [
          'Serve Onboarding - Constituency Profile Viewed',
          'Poll Onboarding - Insights Viewed',
        ],
        [
          'Serve Onboarding - Meet Your Constituents Viewed',
          'Poll Onboarding - Loading Insights Viewed',
        ],
        [
          'Serve Onboarding - Sworn In Viewed',
          'Poll Onboarding - Sworn In Viewed',
        ],
        [
          'Serve Onboarding - Sworn In Completed',
          'Poll Onboarding - Sworn In Completed',
        ],
        [
          'Serve Onboarding - Poll Value Props Viewed',
          'Poll Onboarding - Outreach Prelude Viewed',
        ],
        [
          'Serve Onboarding - Poll Strategy Viewed',
          'Poll Onboarding - Strategy Viewed',
        ],
        [
          'Serve Onboarding - Add Image Viewed',
          'Poll Onboarding - Add Image Viewed',
        ],
        [
          'Serve Onboarding - Poll Preview Viewed',
          'Poll Onboarding - Preview Viewed',
        ],
      ],
    },
  }

  const CAMPAIGN_TRACKER = {
    kind: 'page',
    name: 'Campaign Tracker',
    route: '/dashboard/campaign-plan',
    src: 'packages/gp-webapp/app/dashboard/campaign-plan',
    note: 'two zones, and the only event on this map whose display name differs from its type',
    zones: [
      {
        id: 'tracker',
        t: 'The campaign tracker itself',
        state: 'ok',
        evs: ['Campaign Plan - Campaign Tracker Viewed'],
      },
      {
        id: 'plan-download',
        t: 'Downloading the plan',
        state: 'anchorgap',
        evs: ['Dashboard - Campaign Plan: Plan Downloaded'],
        note: [
          'warn',
          'Label and type differ',
          'This is the one event here where the two are not the same string. It displays as <b>Campaign Plan - Plan Downloaded</b>; its type is still <code>Dashboard - Campaign Plan: Plan Downloaded</code>. Someone relabelled it when the area was renamed, and every chart kept working because they all filter on the type.',
        ],
      },
    ],
  }

  // ------------------------------------------------------------------- tree
  // Product -> area -> surface. `inMap` says whether the area is declared in
  // productMap.ts, the file CI already keeps in step with the nav. The areas
  // that are not in it are the ones nothing keeps honest.
  // A flow the gap sweep located by file but nobody has drawn yet. It takes its place on
  // the map so the map never reads as complete, and opens to the file its steps live in.
  const building = (name, route, src, note) => ({
    kind: 'flow',
    building: true,
    name,
    route,
    src,
    note,
  })

  const TREE = [
    {
      product: 'Win',
      blurb: 'What a candidate running for office sees.',
      areas: [
        {
          name: 'Onboarding',
          route: '/onboarding/[slug]/[step]',
          inMap: false,
          surfaces: [
            WIN_ONBOARDING,
            building(
              'Follow-on onboarding',
              '/onboarding/[slug]/[step]',
              'packages/gp-webapp/app/onboarding/components/FollowOnFlow.tsx',
              'steps are computed at runtime from another list, so reading them means running the code, not grepping it',
            ),
          ],
        },
        {
          name: 'Campaign Manager',
          route: '/dashboard',
          inMap: true,
          surfaces: [DASHBOARD],
        },
        {
          name: 'Voter Outreach',
          route: '/dashboard/outreach',
          inMap: true,
          surfaces: [
            SMS_WIZARD,
            building(
              'Robocall wizard',
              '/dashboard/outreach',
              'packages/gp-webapp/app/dashboard/outreach/v2/robocall/RobocallFlow.tsx',
              'six steps on the same shell as SMS, instrumented by the same property-discriminated pair',
            ),
            building(
              'Social wizard',
              '/dashboard/outreach',
              'packages/gp-webapp/app/dashboard/outreach/v2/social/SocialFlow.tsx',
              'four steps on the same shell as SMS',
            ),
            building(
              'Outreach gate',
              '/dashboard/outreach',
              'packages/gp-webapp/app/dashboard/outreach/v2/OutreachGate.tsx',
              'the gate sub-flow that borrows the wizard chrome mid-flow',
            ),
          ],
        },
        {
          name: 'Campaign Tracker',
          route: '/dashboard/campaign-plan',
          inMap: true,
          surfaces: [CAMPAIGN_TRACKER],
        },
        {
          name: 'Candidate website',
          route: '/dashboard/website',
          inMap: true,
          surfaces: [
            building(
              'Create a website',
              '/dashboard/website/create',
              'packages/gp-webapp/app/dashboard/website/create/components/WebsiteCreateFlow.tsx',
            ),
            building(
              'Website editor',
              '/dashboard/website/editor',
              'packages/gp-webapp/app/dashboard/website/editor/components/WebsiteEditorPageStepper.tsx',
            ),
          ],
        },
        {
          name: 'Pro upgrade',
          route: '/dashboard/pro-upgrade',
          inMap: true,
          surfaces: [
            building(
              'Pro upgrade flow',
              '/dashboard/pro-upgrade',
              'packages/gp-webapp/app/dashboard/pro-upgrade/components/ProUpgradeFlow.tsx',
              'the Pro Upgrade events on the Campaign Manager page are the entry; the flow itself is not drawn',
            ),
          ],
        },
        {
          name: 'Campaign verification',
          route: '/dashboard/campaign-verification',
          inMap: true,
          surfaces: [
            building(
              'Campaign verification',
              '/dashboard/campaign-verification',
              'packages/gp-webapp/app/dashboard/campaign-verification/components/CampaignVerificationFlow.tsx',
            ),
          ],
        },
        {
          name: 'Door knocking',
          route: '/dashboard/door-knocking',
          inMap: true,
          surfaces: [
            building(
              'Create a door-knocking route',
              '/dashboard/door-knocking',
              'packages/gp-webapp/app/dashboard/door-knocking/native/createFlow/createFlowSteps.ts',
              'declared as PRE_DRAW_STAGES; Win and Serve share this area',
            ),
          ],
        },
      ],
    },
    {
      product: 'Serve',
      blurb: 'What an elected official sees.',
      areas: [
        {
          name: 'Serve onboarding',
          route: '/serve/onboarding',
          inMap: false,
          surfaces: [SERVE_ONBOARDING],
        },
        {
          name: 'Poll onboarding',
          route: '/polls/onboarding',
          inMap: false,
          surfaces: [POLL_ONBOARDING],
        },
        {
          name: 'Ordinances',
          route: '/dashboard/ordinances',
          inMap: true,
          surfaces: [
            building(
              'Draft an ordinance',
              '/dashboard/ordinances',
              'packages/gp-webapp/app/dashboard/ordinances/components/OrdinanceStepper.tsx',
              'declared as a record keyed by step',
            ),
          ],
        },
        {
          name: 'Polls',
          route: '/dashboard/polls',
          inMap: true,
          surfaces: [
            building(
              'Expand a poll',
              '/dashboard/polls/[id]/expand',
              'packages/gp-webapp/app/dashboard/polls/[id]/expand/shared/ExpandStepFooter.tsx',
            ),
          ],
        },
      ],
    },
  ]

  // --------------------------------------------------------------- helpers
  const AMP_ORG = 'goodparty'
  const ampUrl = (t) =>
    `https://app.amplitude.com/data/${AMP_ORG}/default/events/main/latest/` +
    encodeURIComponent(t) +
    '?view=All&eventsTab=Events&tab=DETAILS&propertyValidityFilter=All%2520Properties'
  const prUrl = (pr) => `https://github.com/thegoodparty/omni/pull/${pr}`

  // The explorer blanks every 'n/a (...)' route, which hides three different
  // situations behind one empty string. Each wants a different next action.
  const ANCHOR = {
    ok: null,
    none: [
      'warn',
      'no anchor',
      'No anchor record exists. The route this fires on is unrecorded.',
    ],
    nosite: [
      'warn',
      'call site unknown',
      'Anchored, but no call site was found — usually dynamic dispatch.',
    ],
    noroute: [
      'mute',
      'no route',
      'Anchored as deliberately routeless. Nothing to place on a page.',
    ],
  }
  // Compare the first path segment, not the whole route: /onboarding and
  // /onboarding/[slug]/[step] are the same surface; /polls/onboarding is not.
  const family = (r) => (r || '').split('/').filter(Boolean)[0] || ''

  const esc = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    )
  const num = (n) => Number(n).toLocaleString('en-US')
  const fdate = (iso) =>
    iso
      ? new Date(iso).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        })
      : ''
  const shown = (n, e) => (e && e[12] ? e[12] : n)

  const ICON_EXT =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>'
  const ICON_COPY =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>'
  const ICON_CARET =
    '<svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>'

  // The prepared prompt the 2546 sketch asks for: the third exit, next to Amplitude
  // and the PR. Copy, not a live call — the page is static and the work happens in
  // a session where the repo is already open.
  function claudePrompt(name, e, ctx) {
    const [st, c30, , , url, desc, fires, pr, idate] = e
    return [
      `Look into the analytics event with type "${name}".`,
      e[12]
        ? `It displays in Amplitude as "${e[12]}"; the type above is the identifier.`
        : '',
      ``,
      `Where it sits: ${ctx}`,
      `Status: ${st}, ${num(c30)} events in the last 30 days.`,
      fires ? `Fires on: ${fires}` : '',
      url
        ? `Route: ${url}`
        : `Route: not anchored — no record of where this fires.`,
      desc ? `Answers: ${desc}` : '',
      pr
        ? `Instrumented in https://github.com/thegoodparty/omni/pull/${pr}${idate ? ` on ${idate}` : ''}`
        : '',
      ``,
      `Find the call site, confirm the event still fires where the map says it does,`,
      `and tell me whether the display name still matches the surface it fires on.`,
    ]
      .filter((l) => l !== '')
      .join('\n')
  }

  // The event card is the shared one (surfaces/shared/card.js), rendered into this slot
  // the first time the row opens. What the map adds underneath is what only the map
  // knows: how the event is anchored to this step, and a prepared prompt.
  function detail(name, e, ctx) {
    return `<div class="cardslot" data-card="${esc(name)}" data-ctx="${esc(ctx)}"></div>`
  }
  function fillCard(slot) {
    if (slot.dataset.filled) return
    slot.dataset.filled = '1'
    const name = slot.dataset.card,
      ctx = slot.dataset.ctx,
      e = EV[name]
    slot.appendChild(EventCard.render(name))
    const extras = []
    const A = e && ANCHOR[e[10]]
    if (A)
      extras.push(
        `<div class="mnote ${A[0] === 'mute' ? 'drift' : 'warn'}"><span class="mk">${esc(A[1])}</span><span>${esc(A[2])}</span></div>`,
      )
    if (e)
      extras.push(
        `<div class="acts"><button class="act" data-copy="${esc(claudePrompt(name, e, ctx))}">Copy a prompt for Claude ${ICON_COPY}</button></div>`,
      )
    slot.insertAdjacentHTML('beforeend', extras.join(''))
  }
  document.addEventListener(
    'toggle',
    (ev) => {
      const d = ev.target
      if (
        !(d instanceof HTMLDetailsElement) ||
        !d.classList.contains('evd') ||
        !d.open
      )
        return
      const slot = d.querySelector('.cardslot')
      if (slot) {
        fillCard(slot)
        USAGE.opened(slot.dataset.card)
      }
    },
    true,
  )

  // ---------------------------------------------------------------- filtering
  // Set by render(). Null draws the whole map. Otherwise `hit` is the set of event types
  // the page's search and filters kept, and `text` matches a step, flow or area by its
  // own words, so a step with no event is still findable by what it is called.
  let VIEW = null
  const isHit = (n) => !!(VIEW && VIEW.hit.has(n))
  const textHit = (s) => !!(VIEW && VIEW.text && VIEW.text(s))
  const stepNames = (s) => [
    ...(s.evs || []),
    ...(s.shared || []).map((x) => x[0]),
  ]
  const stepHit = (s) => stepNames(s).some(isHit) || textHit(`${s.t} ${s.id}`)
  const nodesOf = (f) =>
    f.kind === 'page'
      ? f.zones
      : f.steps || [
          ...f.head,
          f.branch.left.step,
          f.branch.right.step,
          ...f.tail,
        ]
  const surfaceText = (f) => `${f.name} ${f.route} ${f.note || ''}`

  // Open state is kept by name so a re-render (every keystroke) does not snap shut what
  // someone opened. Only clicks write it: a <details> parsed with `open` fires `toggle`
  // too, and recording those would leave every filtered flow open after the filter clears.
  const OPEN = {}
  const isOpen = (key, byDefault) => (key in OPEN ? OPEN[key] : byDefault)

  function evRow(name, opts, ctx, propVal) {
    const forceUnclean = opts && opts.unclean
    const e = EV[name]
    if (!e)
      return `<details class="evd" data-clean="0"><summary class="ev"><i class="evdot dormant"></i><span class="mevname">${esc(name)}</span><span class="tag warn">not in snapshot</span></summary></details>`
    const st = e[0],
      tags = []
    if (propVal) tags.push(['ok', 'step = ' + propVal])
    if (forceUnclean) tags.push(['warn', 'anchor disagrees'])
    if (opts && opts.legacy && name.startsWith(opts.legacy))
      tags.push(['drift', 'legacy'])
    const A = ANCHOR[e[10]]
    if (A) tags.push([A[0], A[1]])
    if (st !== 'active') tags.push(['mute', st.replace(/_/g, ' ')])
    const clean =
      !forceUnclean &&
      st === 'active' &&
      e[10] === 'ok' &&
      !(opts && opts.legacy && name.startsWith(opts.legacy))
    // The label is what a person reads in Amplitude; the type is what every chart
    // filters on. They match for 589 of 593 events, so the type is only spelled
    // out where it would otherwise be a surprise.
    const typeLine = e[12]
      ? `<span class="typeline">event type <code>${esc(name)}</code></span>`
      : ''
    return (
      `<details class="evd${isHit(name) ? ' hit' : ''}" data-clean="${clean ? 1 : 0}"><summary class="ev"><i class="evdot ${st}"></i>` +
      `<span class="mevname">${esc(shown(name, e))}${typeLine}</span>` +
      tags.map(([c, t]) => `<span class="tag ${c}">${esc(t)}</span>`).join('') +
      `<span class="evnum">${propVal ? '—' : num(e[1])}</span></summary>${detail(name, e, ctx)}</details>`
    )
  }

  function emptyBlock(s, f) {
    const p = [
      `No event fires on the step "${s.t}" (${s.id}) in the ${f.name} flow at ${f.route}.`,
      `It is step ${s.n} of ${f.total}. The steps on either side both fire a Viewed event,`,
      `so drop-off across this step cannot be attributed.`,
      ``,
      `Component: ${s.empty.src}`,
      ``,
      `Read the component, decide whether this step warrants an event, and if it does,`,
      `propose the event name and where it should fire following the instrument-analytics-event skill.`,
    ].join('\n')
    return `<div class="hole">
    <div class="hd"><i class="sw alert"></i> Nothing is attributed to this ${f.kind === 'page' ? 'zone' : 'step'}</div>
    <p>${s.empty.why}</p>
    <div class="src">${esc(s.empty.src)}</div>
    <div class="acts"><button class="act" data-copy="${esc(p)}">Copy a prompt for Claude ${ICON_COPY}</button></div>
  </div>`
  }

  function nodeHTML(s, idx, f) {
    const own = s.evs || [],
      shared = s.shared || []
    const vol = own.reduce((m, n) => Math.max(m, EV[n] ? EV[n][1] : 0), 0)
    const pct = Math.max(0.6, (vol / f.max) * 100)
    const routes = [
      ...new Set(
        own
          .map((n) => EV[n] && EV[n][4])
          .filter((r) => r && !r.startsWith('n/a')),
      ),
    ]
    const fam = family(f.route)
    const odd = routes.filter((r) => family(r) !== fam)
    const rline = routes.length
      ? `<div class="nroute">route: ${routes.map((r) => (family(r) === fam ? esc(r) : '<b>' + esc(r) + '</b>')).join(' · ')}${odd.length ? ' — a different surface from this one' : ''}</div>`
      : ''
    const rec = s.rec
      ? `<div class="rec"><span class="meter">${[1, 2, 3].map((i) => `<i class="seg${i <= s.rec[2] ? ' on' : ''}"></i>`).join('')}</span> last changed ${s.rec[0]} · ${s.rec[1]} commit${s.rec[1] === 1 ? '' : 's'} in 90d</div>`
      : ''
    const note = s.note
      ? `<div class="mnote ${s.note[0]}"><span class="mk">${esc(s.note[1])}</span><span>${s.note[2]}</span></div>`
      : ''
    const ctx = `${f.name} → ${f.kind === 'page' ? 'zone' : 'step'} "${s.t}" (${s.id}) at ${f.route}`
    const allNames = stepNames(s)
    const ok = (n) =>
      EV[n] &&
      EV[n][0] === 'active' &&
      EV[n][10] === 'ok' &&
      !(s.legacy && n.startsWith(s.legacy))
    const clean =
      (s.state === 'ok' || s.state === 'shared') &&
      allNames.length > 0 &&
      allNames.every(ok)
    const anyclean = allNames.some(ok)
    // A filtered flow keeps its whole shape, so a match is seen in place between the
    // steps around it; the steps that did not match are dimmed, not removed.
    const miss = VIEW && !f._whole && !stepHit(s)
    const volRow = own.length
      ? `<div class="vol"><span class="track"><span class="fill" style="width:${pct}%"></span></span><span class="volnum">${num(vol)}</span><span class="volcap">/30d</span></div>`
      : ''
    const sharedRows = shared.length
      ? `<div class="evs">${shared.map(([n, v]) => evRow(n, s, ctx, v)).join('')}</div>
    <div class="sharednote">counted per event, not per step — splitting it needs a property breakdown in Amplitude</div>`
      : ''
    return `<article class="node" data-state="${s.state}" data-clean="${clean ? 1 : 0}" data-anyclean="${anyclean ? 1 : 0}"${miss ? ' data-miss="1"' : ''}>
    <div class="nhead"><span class="nidx">${idx ?? '↳'}</span><h3 class="ntitle">${esc(s.t)}</h3><span class="nid">${esc(s.id)}</span></div>
    ${rline}${volRow}
    ${own.length ? `<div class="evs">${own.map((n) => evRow(n, s, ctx)).join('')}</div>` : ''}
    ${sharedRows}
    ${s.empty ? emptyBlock(s, f) : ''}
    ${note}${rec}
  </article>`
  }

  const conn = '<div class="conn"><i></i></div>'

  function relabelHTML(r) {
    const p =
      'Nine analytics events display in Amplitude as "Serve Onboarding - ..." but every one is anchored to /polls/onboarding, which is the poll onboarding flow, not Serve onboarding. Serve onboarding is a separate flow at /serve/onboarding with its own events.\n\n' +
      r.pairs.map(([a, b]) => `${a}  ->  ${b}`).join('\n') +
      '\n\nThese are display-name changes, not renames: the event type stays as it is. All nine are ingested and active, so Amplitude should set displayName only and leave the type alone — confirm that, check whether anything downstream reads the display name rather than the type, and tell me whether to go ahead.'
    return `<div class="rename"><h4>${esc(r.title)}</h4><p>${r.body}</p>
    <div class="rmap">${r.pairs
      .map(
        ([a, b]) =>
          `<div class="rrow"><span class="from">${esc(a)}</span><span class="ar">→</span><span class="to">${esc(b)}</span></div>`,
      )
      .join('')}</div>
    <div class="termnote">
      <p><b>Relabel</b> — change the display name. The event type underneath is untouched, so every chart, cohort and dbt model keeps working and the history stays continuous. Free and reversible. This is what the table proposes.</p>
      <p><b>Rename</b> — not a thing you can do. An event type is an identifier and cannot change. The nearest equivalent is instrumenting a new event, migrating every consumer to it, and retiring the old one, which splits the history at the cutover.</p>
      <p>One caveat: Amplitude's rename control sets the display name only for events it has already ingested. For an event it has never seen, it edits the plan entry instead. All nine here are active, so all nine are label changes.</p>
      <p>There is already a precedent in the catalog. The event type <code>Dashboard - Campaign Plan: Plan Downloaded</code> displays as <b>Campaign Plan - Plan Downloaded</b> — one of only four events out of 593 where the two differ at all.</p>
    </div>
    <div class="acts"><button class="act" data-copy="${esc(p)}">Copy a prompt for Claude ${ICON_COPY}</button></div>
  </div>`
  }

  // Null when a filter is on and nothing in the surface matches it.
  function surfaceHTML(f, wholeArea) {
    const whole = !VIEW || wholeArea || textHit(surfaceText(f))
    const openAttr = isOpen('flow:' + f.name, !!VIEW) ? ' open' : ''
    if (f.building) {
      if (!whole && !textHit(f.src)) return null
      return {
        clean: true,
        building: true,
        html: `<details class="flow" data-clean="1" data-key="${esc('flow:' + f.name)}"${openAttr}><summary class="fsum">${ICON_CARET}
      <div class="fmain">
        <div class="ftitle"><h2>${esc(f.name)}</h2><span class="route">${esc(f.route)}</span>
          <span class="fkind building">Still being built</span></div>
        <div class="fmeta"><span>steps not yet read</span>${f.note ? `<span>${esc(f.note)}</span>` : ''}</div>
      </div>
    </summary><div class="fbody"><p class="notyet">Nothing is drawn here yet. The flow is real and its steps are declared in
      <code>${esc(f.src)}</code>; they need reading out of the code once, after which only a file that changes gets re-read.
      Until then the events that fire on it are in the explorer, not on this map.</p></div></details>`,
      }
    }
    const nodes = nodesOf(f)
    f._whole = whole
    if (!whole) {
      const extra = [
        ...((f.offstep || {}).evs || []),
        ...((f.unplaced || {}).evs || []),
      ]
      if (!nodes.some(stepHit) && !extra.some(isHit)) return null
    }
    nodes.forEach((s, i) => {
      s.n = i + 1
    })
    f.total = nodes.length
    f.max = Math.max(
      1,
      ...nodes.flatMap((s) => (s.evs || []).map((n) => (EV[n] ? EV[n][1] : 0))),
    )
    const all = [...new Set(nodes.flatMap(stepNames))]
    const gaps = all.filter(
      (n) => EV[n] && (EV[n][10] === 'none' || EV[n][10] === 'nosite'),
    ).length
    const overlap = nodes.filter((s) => s.state === 'overlap').length
    const bare = nodes.filter((s) => s.state === 'none').length
    const unit = f.kind === 'page' ? 'zone' : 'step'
    const stats = [`<span class="stat ok">${all.length} events</span>`]
    if (bare)
      stats.push(
        `<span class="stat alert">${bare} ${unit}${bare === 1 ? '' : 's'} with none</span>`,
      )
    if (gaps) stats.push(`<span class="stat warn">${gaps} unplaceable</span>`)
    if (overlap)
      stats.push(`<span class="stat drift">${overlap} overlapping</span>`)
    if (f.unplaced)
      stats.push(
        `<span class="stat warn">${f.unplaced.evs.length} misanchored</span>`,
      )
    if (f.relabel)
      stats.push(
        `<span class="stat drift">${f.relabel.pairs.length} relabel</span>`,
      )

    let body = f.intro
      ? `<div class="mnote ${f.intro[0]}" style="margin:0 0 14px"><span class="mk">${esc(f.intro[1])}</span><span>${f.intro[2]}</span></div>`
      : ''
    if (f.kind === 'page') {
      body += `<div class="zones">${nodes.map((s) => nodeHTML(s, '▪', f)).join('')}</div>`
    } else if (f.steps) {
      body += nodes.map((s, i) => nodeHTML(s, i + 1, f)).join(conn)
    } else {
      body += f.head.map((s, i) => nodeHTML(s, i + 1, f)).join(conn) + conn
      body +=
        `<div class="branch"><div class="blabel"><span class="k">Branch on</span><code>${esc(f.branch.key)}</code></div>
      <div class="tracks">
        <div><div class="cond">${esc(f.branch.left.cond)}</div>${nodeHTML(f.branch.left.step, null, f)}</div>
        <div><div class="cond">${esc(f.branch.right.cond)}</div>${nodeHTML(f.branch.right.step, null, f)}</div>
      </div><div class="rejoin">both arms rejoin at <b>${esc(f.branch.rejoin)}</b></div></div>` +
        conn
      body += f.tail
        .map((s, i) => nodeHTML(s, f.head.length + 2 + i, f))
        .join(conn)
    }
    if (f.offstep) {
      const ctx = `${f.name} at ${f.route}, reached outside the stepper`
      body += `<div class="unmapped" style="margin-top:16px"><h3>${esc(f.offstep.title)}</h3>
      <div class="evs">${f.offstep.evs.map((n) => evRow(n, {}, ctx)).join('')}</div></div>`
    }
    if (f.siblings) {
      body += `<div class="unmapped" style="margin-top:12px"><h3>Sibling wizards on the same shell</h3>
      <ul class="ulist">${f.siblings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`
    }
    if (f.unplaced) {
      body += `<div class="unplaced"><h4>${esc(f.unplaced.title)}</h4><p>${f.unplaced.body}</p>
      <div class="evs">${f.unplaced.evs.map((n) => evRow(n, { unclean: true }, f.name)).join('')}</div></div>`
    }
    if (f.relabel) body += relabelHTML(f.relabel)
    body +=
      '<div class="allclear">Everything else on this surface is active and anchored.</div>'

    const clean = !gaps && !overlap && !bare && !f.relabel && !f.unplaced
    return {
      clean,
      html: `<details class="flow" data-clean="${clean ? 1 : 0}" data-key="${esc('flow:' + f.name)}"${openAttr}><summary class="fsum">${ICON_CARET}
    <div class="fmain">
      <div class="ftitle"><h2>${esc(f.name)}</h2><span class="route">${esc(f.route)}</span>
        <span class="fkind">${f.kind === 'page' ? 'page' : 'flow'}</span></div>
      <div class="fmeta"><span>${nodes.length} ${unit}s</span><span>${f.note}</span></div>
    </div>
    <div class="fstats">${stats.join('')}</div>
  </summary><div class="fbody"><div class="srcline">${f.kind === 'page' ? 'zones inferred from each event’s fires_on · ' : 'steps declared in '}${esc(f.src)}</div>${body}</div></details>`,
    }
  }

  function areaHTML(a) {
    const wholeArea = !!VIEW && textHit(`${a.name} ${a.route}`)
    const parts = a.surfaces
      .map((f) => surfaceHTML(f, wholeArea))
      .filter(Boolean)
    if (!parts.length) return ''
    const badge = a.inMap
      ? '<span class="mapbadge in">declared in productMap</span>'
      : '<span class="mapbadge out">not in productMap</span>'
    return `<div class="area" data-clean="${parts.every((p) => p.clean) ? 1 : 0}">
    <div class="ahead"><h3>${esc(a.name)}</h3><span class="route">${esc(a.route)}</span>${badge}</div>
    ${parts.map((p) => p.html).join('')}
  </div>`
  }

  function productHTML(p) {
    const areas = p.areas.map(areaHTML).filter(Boolean)
    if (!areas.length) return ''
    const all = p.areas.flatMap((a) => a.surfaces)
    const drawn = all.filter((s) => !s.building).length,
      pending = all.length - drawn
    const openAttr = isOpen('product:' + p.product, true) ? ' open' : ''
    return `<details class="product" data-key="${esc('product:' + p.product)}"${openAttr}><summary class="psum">${ICON_CARET}
    <div class="pmain"><h2>${esc(p.product)}</h2><p>${esc(p.blurb)}</p></div>
    <span class="pcount">${p.areas.length} areas · ${drawn} drawn${pending ? ` · ${pending} still being built` : ''}</span>
  </summary><div class="pbody">${areas.join('')}</div></details>`
  }

  // ----------------------------------------------------------------- controls
  // Layers and the Show filter are body classes, so they survive the page re-rendering
  // the map on every keystroke; the buttons are redrawn from this state each time.
  const LAYERS = { events: true, volume: true, recency: true }
  let SHOW = ''
  function syncBody() {
    const b = document.body
    Object.keys(LAYERS).forEach((l) => b.classList.toggle('L-' + l, LAYERS[l]))
    b.classList.toggle('F-attention', SHOW === 'attention')
    b.classList.toggle('F-healthy', SHOW === 'healthy')
  }
  function pill(attr, val, label, on) {
    return `<button class="pillbtn" ${attr}="${val}" aria-pressed="${on}">${label}</button>`
  }
  function controlsHTML() {
    return (
      `<div class="controls"><span class="lbl">Layers</span>` +
      pill('data-layer', 'events', 'Events', LAYERS.events) +
      pill('data-layer', 'volume', 'Volume', LAYERS.volume) +
      pill('data-layer', 'recency', 'Recent change', LAYERS.recency) +
      `<span class="spacer"></span><button class="pillbtn" data-mapall="1">Expand all flows</button>` +
      `<button class="pillbtn" data-mapall="0">Collapse all</button></div>` +
      `<div class="controls"><span class="lbl">Show</span>` +
      pill('data-show', '', 'Everything', SHOW === '') +
      pill('data-show', 'attention', 'Needs attention', SHOW === 'attention') +
      pill('data-show', 'healthy', 'Healthy only', SHOW === 'healthy') +
      `</div>` +
      `<div class="maplegend">
      <span><i class="sw ok"></i> Instrumented and anchored</span>
      <span><i class="sw warn"></i> Fires, but no anchor — route unknown</span>
      <span><i class="sw drift"></i> Two event generations live at once</span>
      <span><i class="sw alert"></i> Step with no event at all</span>
    </div>`
    )
  }
  function setAllOpen(on) {
    document
      .querySelectorAll('.mapview details.flow, .mapview details.product')
      .forEach((d) => {
        d.open = on
        OPEN[d.dataset.key] = on
      })
  }
  function mapDrawn() {
    return TREE.flatMap((p) => p.areas).flatMap((a) => a.surfaces)
  }

  const BUILDING_NOTE = `<div class="building">
  <h3>Still being built</h3>
  <p>This is a first version, shared to find out what you can do with it. What is not finished:</p>
  <ul>
    <li><b>Eleven flows are placed but not yet drawn.</b> Each sits under its area above with a "Still being built" tag and opens to the file its steps live in; each needs its step list read out of the code once.</li>
    <li><b>Page zones are inferred.</b> A flow's steps are declared in code; a page's zones are not, so on Campaign Manager and Campaign Tracker the grouping is a reading of each event's own description, not a fact.</li>
    <li><b>Per-step volume on the outreach wizards</b> needs a property breakdown in Amplitude that the snapshot does not hold, so those steps show the event's total, not the step's.</li>
    <li><b>Steps are drawn by hand.</b> Event numbers refresh with the explorer twice a week; the steps themselves are read from each flow's code once and do not yet notice when a flow changes.</li>
  </ul>
</div>
<p class="mapfoot">Coverage here is a best guess. An event missing from a step can mean uninstrumented, instrumented
  but unanchored, or a step that does not warrant one. This view separates the first two and cannot
  yet judge the third. Steps come from each flow's own config in <code>gp-webapp</code>; event
  status, volume, weekly series and provenance from the explorer snapshot; routes from
  <code>event_anchors.json</code>.</p>`

  document.addEventListener('click', (ev) => {
    const sum = ev.target.closest(
      '.mapview summary.fsum, .mapview summary.psum',
    )
    if (sum) {
      OPEN[sum.parentElement.dataset.key] = !sum.parentElement.open
      return
    }
    const b = ev.target.closest(
      '.mapview [data-layer], .mapview [data-show], .mapview [data-mapall]',
    )
    if (b) {
      if (b.dataset.layer) {
        LAYERS[b.dataset.layer] = !LAYERS[b.dataset.layer]
        b.setAttribute('aria-pressed', String(LAYERS[b.dataset.layer]))
      } else if ('show' in b.dataset) {
        SHOW = b.dataset.show
        document
          .querySelectorAll('.mapview [data-show]')
          .forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
        // Opening everything is the point of a filter: the rows worth seeing are
        // inside collapsed surfaces, and leaving them shut hides the answer.
        if (SHOW) setAllOpen(true)
      } else {
        setAllOpen(b.dataset.mapall === '1')
      }
      syncBody()
      return
    }
    const c = ev.target.closest('.mapview [data-copy]')
    if (!c) return
    ev.preventDefault()
    const original = c.innerHTML
    navigator.clipboard.writeText(c.dataset.copy).then(
      () => {
        c.textContent = 'Copied'
      },
      () => {
        c.textContent = 'Press ⌘C to copy'
        const t = document.createElement('textarea')
        t.value = c.dataset.copy
        t.style.position = 'fixed'
        t.style.opacity = '0'
        document.body.appendChild(t)
        t.select()
        setTimeout(() => t.remove(), 8000)
      },
    )
    setTimeout(() => {
      c.innerHTML = original
    }, 1800)
  })

  // `view` is null for the whole map, or {hit: Set of event types, text: fn(string) -> bool}.
  // Returns the section body and how many flows it drew.
  function render(view) {
    VIEW = view
    syncBody()
    const tree = TREE.map(productHTML).join('')
    const flows = (tree.match(/<details class="flow"/g) || []).length
    const body =
      `<div class="mapview">${controlsHTML()}` +
      (tree
        ? `<div class="flows">${tree}</div>`
        : `<div class="mapempty">No flow on the map matches. The map draws ${mapDrawn().filter((s) => !s.building).length} flows and pages so far, so a match can still be an event on a flow it has not drawn.</div>`) +
      (view ? '' : BUILDING_NOTE) +
      `</div>`
    VIEW = null
    return { html: body, flows }
  }

  // Every event the tree names, so search can say which matches are not on a drawn flow.
  const ON_MAP = new Set(
    TREE.flatMap((p) => p.areas)
      .flatMap((a) => a.surfaces)
      .filter((f) => !f.building)
      .flatMap((f) => [
        ...nodesOf(f).flatMap(stepNames),
        ...((f.offstep || {}).evs || []),
        ...((f.unplaced || {}).evs || []),
      ]),
  )

  return {
    render,
    has: (n) => ON_MAP.has(n),
    surfaces: () => mapDrawn(),
  }
})()
