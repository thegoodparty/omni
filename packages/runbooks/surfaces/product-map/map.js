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
    route: '/onboarding/office-selection',
    src: 'packages/gp-webapp/app/onboarding/components/OnboardingFlow.tsx + onboardingConfig.ts',
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
    src: 'packages/gp-webapp/app/dashboard/outreach/v2/sms/SmsFlow.tsx + v2/OutreachFlowShell.tsx',
    note: 'five steps behind one route, instrumented by a property rather than by name',
    intro: [
      'warn',
      'One event pair covers every step',
      'This flow fires no event of its own. <b>OutreachFlowShell</b> fires <b>Voter Outreach - Flow Step Viewed</b> and <b>Flow Step Completed</b> for all four channel wizards, carrying <code>channel</code> and <code>step</code> as properties. So every step here is instrumented, but no step has an event named after it, and the snapshot holds event-level totals only — per-step volume needs a property breakdown in Amplitude. A map that matched steps to event names would have called all five of these uninstrumented.',
    ],
    steps: [
      {
        id: 'purpose',
        t: 'What do you want to do?',
        state: 'shared',
        evs: [],
        shared: [
          ['Voter Outreach - Flow Step Viewed', 'purpose'],
          ['Voter Outreach - Flow Step Completed', 'purpose'],
        ],
      },
      {
        id: 'audience',
        t: 'Who do you want to reach?',
        state: 'shared',
        evs: [],
        shared: [
          ['Voter Outreach - Flow Step Viewed', 'audience'],
          ['Voter Outreach - Flow Step Completed', 'audience'],
        ],
      },
      {
        id: 'schedule',
        t: 'When do you want to send it?',
        state: 'shared',
        evs: [],
        shared: [
          ['Voter Outreach - Flow Step Viewed', 'schedule'],
          ['Voter Outreach - Flow Step Completed', 'schedule'],
        ],
      },
      {
        id: 'compose',
        t: 'What do you want to say?',
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
    src: 'packages/gp-webapp/app/serve/onboarding/ServeOnboardingFlow.tsx + serveOnboardingConfig.ts',
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

  const WEBSITE_CREATE = {
    kind: 'flow',
    name: 'Create a website',
    route: '/dashboard/website/create',
    src: 'packages/gp-webapp/app/dashboard/website/create/components/WebsiteCreateFlow.tsx',
    note: 'six build steps and a finish screen; resumes at the saved step',
    intro: [
      'warn',
      'Six steps, no events, no link in',
      'The flow opens from the website hub and ends in a publish, and nothing fires in between. <b>Candidate Website - Published</b> is a backend event on first publish only, so drop-off between the link and the publish button cannot be seen. Since the website nav item was removed in June, no link in the app reaches the website hub, yet <b>Candidate Website - Continued</b> still fires there, so people arrive another way (a saved link, an email, or typing the URL).',
    ],
    steps: [
      {
        id: 'vanity-path',
        t: 'What do you want your custom link to be?',
        state: 'none',
        evs: [],
      },
      {
        id: 'logo',
        t: 'Upload your campaign logo if you have one',
        state: 'none',
        evs: [],
      },
      { id: 'theme', t: 'Choose a color theme', state: 'none', evs: [] },
      {
        id: 'hero',
        t: 'Customize the content visitors will see first',
        state: 'none',
        evs: [],
      },
      {
        id: 'about',
        t: 'What is your campaign about?',
        state: 'none',
        evs: [],
      },
      {
        id: 'contact',
        t: 'How can voters contact you?',
        state: 'none',
        evs: [],
        note: [
          'warn',
          'Publish is backend only',
          'The button here is <b>Publish website</b>. Its only event is <b>Candidate Website - Published</b>, fired by gp-api on the first publish, so a republish or a failed publish leaves no trace.',
        ],
      },
      {
        id: 'complete',
        t: 'Congratulations, your website is live!',
        state: 'ok',
        evs: ['Candidate Website - Started domain selection'],
        note: [
          'warn',
          'Not unique to this step',
          'The same event fires from the website card on the hub, so its count is not this step’s.',
        ],
      },
    ],
    offstep: {
      title: 'The hub this flow opens from, and the publish',
      evs: [
        'Candidate Website - Started',
        'Candidate Website - Continued',
        'Candidate Website - Published',
      ],
    },
  }

  const WEBSITE_EDITOR = {
    kind: 'page',
    name: 'Website editor',
    route: '/dashboard/website/editor',
    src: 'packages/gp-webapp/app/dashboard/website/editor/components/WebsiteEditFlow.tsx',
    note: 'six sections behind one Save, and one event for all of them',
    intro: [
      'warn',
      'One event for every section',
      'Each section saves through the same handler, which fires <b>Candidate Website - Edited</b> with no property naming the section, and only when the site is already published. Which section people change cannot be told apart. Since the website nav item was removed in June, no link in the app reaches the website hub, yet <b>Candidate Website - Continued</b> still fires there, so people arrive another way (a saved link, an email, or typing the URL).',
    ],
    zones: [
      {
        id: 'sections',
        t: 'Custom link, logo, color theme, title, campaign and contact details',
        state: 'ok',
        evs: ['Candidate Website - Edited'],
      },
      {
        id: 'preview',
        t: 'Preview',
        state: 'none',
        evs: [],
      },
      {
        id: 'unpublish',
        t: 'Unpublish, from the settings menu',
        state: 'ok',
        evs: ['Candidate Website - Unpublished'],
      },
    ],
  }

  const CAMPAIGN_VERIFICATION = {
    kind: 'flow',
    name: 'Campaign verification',
    route: '/dashboard/campaign-verification',
    src: 'packages/gp-webapp/app/dashboard/campaign-verification/components/CampaignVerificationSteps.tsx',
    note: 'three steps; the same steps also open inside the outreach gate',
    steps: [
      {
        id: 'intro',
        t: 'Verify your campaign to text voters',
        state: 'ok',
        evs: [
          'Pro Upgrade - Verification Intro Viewed',
          'Pro Upgrade - Verification Intro: Click continue',
        ],
      },
      {
        id: 'form',
        t: 'What are your campaign filing details?',
        state: 'ok',
        evs: [
          'Pro Upgrade - Filing Details Viewed',
          'Pro Upgrade - Filing Details Submitted',
          'Pro Upgrade - Filing Details Submit Error',
          'Profile - Candidate Profile: Click Submit',
          'Pro Upgrade - Candidate Profile Submitted',
        ],
        note: [
          'warn',
          'Shared form',
          'This form also runs on the election filing page and in the Pro upgrade flow, so these counts are not verification volume. The profile section only shows when the profile is incomplete.',
        ],
      },
      {
        id: 'submitted',
        t: 'Submitted for verification',
        state: 'ok',
        evs: ['Pro Upgrade - Verification Submitted Viewed'],
      },
    ],
  }

  const ORDINANCE = {
    kind: 'flow',
    name: 'Draft an ordinance',
    route: '/dashboard/ordinances/solve/[slug]/[step]',
    src: 'packages/gp-webapp/app/dashboard/ordinances/data/steps.ts + components/OrdinanceFlowChat.tsx',
    note: 'five numbered steps, one page each, a Viewed and Completed pair named after every step',
    steps: [
      {
        id: 'clarify',
        t: 'Clarify',
        state: 'ok',
        evs: ['Ordinances - Clarify Viewed', 'Ordinances - Clarify Completed'],
      },
      {
        id: 'authority',
        t: 'Authority',
        state: 'ok',
        evs: [
          'Ordinances - Authority Viewed',
          'Ordinances - Authority Completed',
        ],
      },
      {
        id: 'current_law',
        t: 'Current law',
        state: 'ok',
        evs: [
          'Ordinances - Current Law Viewed',
          'Ordinances - Current Law Completed',
        ],
      },
      {
        id: 'comparables',
        t: 'How others solved it',
        state: 'ok',
        evs: [
          'Ordinances - How Others Solved It Viewed',
          'Ordinances - How Others Solved It Completed',
        ],
      },
      {
        id: 'draft',
        t: 'Draft',
        state: 'ok',
        evs: [
          'Ordinances - Draft Creation Viewed',
          'Ordinances - Draft Creation Completed',
        ],
        note: [
          'warn',
          'Completed is not a click',
          'Every other step completes on its advance button. This one completes when the drafted ordinance lands in the chat.',
        ],
      },
      {
        id: 'review',
        t: 'Review the draft',
        state: 'ok',
        evs: [
          'Ordinances - Draft Details Viewed',
          'Ordinances - Draft Chat Opened',
          'Ordinances - Draft Chat Message Sent',
        ],
        note: [
          'warn',
          'A different page',
          'Review runs on the draft page, <b>/dashboard/ordinances/draft/[slug]</b>, which the ready draft links to. It is not a sixth step on the solve route.',
        ],
      },
    ],
    offstep: {
      title: 'Starting an ordinance, and the draft page',
      evs: [
        'Ordinances - New Ordinance Created',
        'Ordinances - New Ordinance Errored',
        'Ordinances - Draft Details Downloaded',
        'Ordinances - Draft Details Status Updated',
        'Ordinances - Draft Details Deleted',
        'Ordinances - Bug Report Submitted',
        'Ordinances - Bug Report Errored',
      ],
    },
  }

  const POLL_EXPAND = {
    kind: 'flow',
    name: 'Expand a poll',
    route: '/dashboard/polls/[id]/expand',
    src: 'packages/gp-webapp/app/dashboard/polls/[id]/expand (+ expand-review, expand-payment, expand-payment-success)',
    note: 'four sibling routes; the footer says three steps, the flow has four and a success page',
    steps: [
      {
        id: 'audience-selection',
        t: 'How many more messages would you like to send?',
        state: 'ok',
        evs: [
          'Polls - Expand Poll Recommendations Viewed',
          'Polls - Expand Poll Recommendations Completed',
        ],
        note: [
          'warn',
          'Fires on mount',
          'Viewed fires when the page mounts. Going back from review remounts the page on the next step, so this also counts people who are on step two.',
        ],
      },
      {
        id: 'date-selection',
        t: 'When would you like to send your text messages?',
        state: 'none',
        evs: [],
      },
      {
        id: 'review',
        t: 'Review your SMS poll.',
        state: 'ok',
        evs: ['Polls - Expand Poll Review Viewed'],
      },
      {
        id: 'payment',
        t: 'SMS Poll Payment',
        state: 'shared',
        evs: [],
        shared: [
          [
            'Payment - Review and Pay Screen Viewed',
            'Serve Poll Expansion',
            'type',
          ],
          ['Payment - Completed', 'Serve Poll Expansion', 'type'],
        ],
        note: [
          'warn',
          'Shared with creating a poll',
          'Both payment events also fire when a poll is created. Only the <code>type</code> property separates an expansion, so the totals here are not this flow’s.',
        ],
      },
      {
        id: 'success',
        t: 'Payment successful!',
        state: 'none',
        evs: [],
      },
    ],
    offstep: {
      title: 'The dead end when there is no constituent data',
      evs: ['Polls - Constituent Data Unavailable Viewed'],
    },
  }

  const DOOR_KNOCKING = {
    kind: 'flow',
    name: 'Create a door-knocking route',
    route: '/dashboard/door-knocking',
    src: 'packages/gp-webapp/app/dashboard/door-knocking/native/createFlow/CreateListFlow.tsx + createFlowSteps.ts',
    note: 'five steps on the outreach shell, and a sixth for an event invite',
    intro: [
      'warn',
      'One event pair covers every step',
      'Like the SMS wizard, this flow runs on <b>OutreachFlowShell</b>, which fires <b>Voter Outreach - Flow Step Viewed</b> and <b>Flow Step Completed</b> with <code>channel</code> = door and <code>step</code> as properties. Per-step volume needs a property breakdown in Amplitude.',
    ],
    steps: [
      {
        id: 'purpose',
        t: 'What do you want to do?',
        state: 'shared',
        evs: [],
        shared: [
          ['Voter Outreach - Flow Step Viewed', 'purpose'],
          ['Voter Outreach - Flow Step Completed', 'purpose'],
        ],
      },
      {
        id: 'details',
        t: 'When and where is the event?',
        state: 'shared',
        evs: [],
        shared: [
          ['Voter Outreach - Flow Step Viewed', 'details'],
          ['Voter Outreach - Flow Step Completed', 'details'],
        ],
        note: [
          'warn',
          'Event invites only',
          'This step shows only when the purpose is inviting people to an event. Every other purpose goes straight to who.',
        ],
      },
      {
        id: 'who',
        t: 'Who do you want to reach?',
        state: 'shared',
        evs: ['Voter Outreach - Recommended List Accepted'],
        shared: [
          ['Voter Outreach - Flow Step Viewed', 'who'],
          ['Voter Outreach - Flow Step Completed', 'who'],
        ],
        note: [
          'warn',
          'One event, two moments',
          '<b>Recommended List Accepted</b> fires here only when the recommendation reuses a saved list. When it builds a new list, the same event fires at the last step, on Create campaign.',
        ],
      },
      {
        id: 'points',
        t: 'What will you say?',
        state: 'shared',
        evs: [],
        shared: [
          ['Voter Outreach - Flow Step Viewed', 'points'],
          ['Voter Outreach - Flow Step Completed', 'points'],
        ],
      },
      {
        id: 'name',
        t: 'What do you want to name your campaign?',
        state: 'shared',
        evs: [],
        shared: [
          ['Voter Outreach - Flow Step Viewed', 'name'],
          ['Voter Outreach - Flow Step Completed', 'name'],
        ],
      },
      {
        id: 'draw',
        t: 'Where do you want to knock?',
        state: 'shared',
        evs: [
          'Outreach - Door Knocking List Created',
          'Outreach - Campaign Created',
        ],
        shared: [
          ['Voter Outreach - Flow Step Viewed', 'draw'],
          ['Voter Outreach - Flow Step Completed', 'draw'],
        ],
      },
    ],
    offstep: {
      title: 'The gate that can stop the wizard',
      evs: [
        'Outreach - Gate Banner Viewed',
        'Outreach - Gate Explainer Viewed',
        'Outreach - Gate Explainer: Click CTA',
      ],
    },
  }

  // Outreach wizards on OutreachFlowShell: one Viewed/Completed pair, `step` as property.
  const shellStep = (id, t, extra) => ({
    id,
    t,
    state: 'shared',
    evs: [],
    shared: [
      ['Voter Outreach - Flow Step Viewed', id],
      ['Voter Outreach - Flow Step Completed', id],
    ],
    ...extra,
  })

  const SOCIAL_WIZARD = {
    kind: 'flow',
    name: 'Social wizard',
    route: '/dashboard/outreach',
    src: 'packages/gp-webapp/app/dashboard/outreach/v2/social/SocialFlow.tsx',
    note: 'four steps on the same shell as SMS; the same steps run on Serve',
    steps: [
      shellStep('purpose', 'What do you want to do?'),
      shellStep('compose', 'What do you want to say?', {
        evs: ['Dictation - Started', 'Dictation - Failed'],
        note: [
          'warn',
          'Shared with every dictation box',
          'The dictation events fire wherever dictation is offered. Only their <code>label</code> property, outreach-social-compose, places them here.',
        ],
      }),
      shellStep('platforms', 'Where do you want to share it?'),
      shellStep('share', 'Your assets are ready', {
        evs: ['Outreach - Campaign Created', 'Outreach - Campaign Completed'],
        note: [
          'warn',
          'Created and completed together',
          'Both fire on the same save, so social converts at 100% by construction.',
        ],
      }),
    ],
    offstep: {
      title: 'The hub this wizard opens from',
      evs: ['Outreach - Click Create'],
    },
  }

  const ROBOCALL_WIZARD = {
    kind: 'flow',
    name: 'Robocall wizard',
    route: '/dashboard/outreach',
    src: 'packages/gp-webapp/app/dashboard/outreach/v2/robocall/RobocallFlow.tsx',
    note: 'six steps on the same shell as SMS; a gated account builds three and resumes after the gate',
    intro: [
      'warn',
      'The gated path stops counting at compose',
      'When the outreach gate applies, the wizard runs purpose, audience, compose and then opens the gate. Compose never gets a <b>Flow Step Completed</b>, and the flow resumes on schedule, so a gated funnel looks like it ends at audience.',
    ],
    steps: [
      shellStep('purpose', 'What do you want to do?'),
      shellStep('audience', 'Who do you want to reach?', {
        evs: [
          'Voter Outreach - Recommended List Accepted',
          'Voter Outreach - Recommended List Failed',
        ],
      }),
      shellStep('schedule', 'When do you want to send it?'),
      shellStep('compose', 'What do you want to say?', {
        evs: ['Outreach - Draft Saved'],
      }),
      shellStep('review', 'Review your campaign'),
      shellStep('pay', 'Payment', {
        evs: ['Outreach - Campaign Created', 'Outreach - Campaign Completed'],
      }),
    ],
    offstep: {
      title: 'The gate that can stop the wizard',
      evs: [
        'Outreach - Gate Banner Viewed',
        'Outreach - Gate Explainer Viewed',
        'Outreach - Gate Explainer: Click CTA',
      ],
    },
  }

  const FOLLOW_ON = {
    kind: 'flow',
    name: 'Follow-on onboarding',
    route: '/onboarding/office-selection?intent=same-office|new-office',
    src: 'packages/gp-webapp/app/onboarding/components/followOnConfig.ts + FollowOnFlow.tsx',
    note: 'Win onboarding minus the story steps, for a candidate starting a second campaign',
    intro: [
      'warn',
      'Nothing fires yet, on purpose',
      'This flow reuses the Win onboarding steps but not their component, so none of the <b>Onboarding V2</b> events fire here. The code says so and points at DATA-2528 for instrumenting it. Only the backend records the outcome.',
    ],
    steps: [
      {
        id: 'welcome',
        t: "Let's set up your new campaign",
        state: 'none',
        evs: [],
      },
      {
        id: 'ballot-status',
        t: 'Are you already on the ballot?',
        state: 'none',
        evs: [],
      },
      {
        id: 'party-affiliation',
        t: 'Are you running with an official party designation?',
        state: 'none',
        evs: [],
      },
      {
        id: 'office-selection',
        t: 'What office are you running for?',
        state: 'none',
        evs: [],
        note: [
          'warn',
          'New office only',
          'Skipped when the candidate runs for the same office again. Choosing to enter the office by hand swaps the next step for <b>Tell us about your office</b>.',
        ],
      },
      {
        id: 'path-to-victory',
        t: 'Projected votes needed to win',
        state: 'none',
        evs: [],
      },
      {
        id: 'pledge',
        t: 'Take our pledge to get your campaign plan',
        state: 'none',
        evs: [],
      },
    ],
    offstep: {
      title: 'Recorded by the backend when the campaign is created',
      evs: ['Campaign - Follow-On Created', 'Campaign - Follow-On Blocked'],
    },
  }

  const PRO_UPGRADE = {
    kind: 'flow',
    name: 'Pro upgrade flow',
    route: '/dashboard/pro-upgrade',
    src: 'packages/gp-webapp/app/dashboard/pro-upgrade/components/ProUpgradeWizard.tsx + ProUpgradeFlow.tsx + proUpgradeStep.ts',
    note: 'drawn in the purchase-only order; with outreach-pro-gating-v2 off, the route wizard adds steps not drawn here',
    intro: [
      'warn',
      'Two shells, one set of events',
      'The route wizard at <b>/dashboard/pro-upgrade</b> and this flow inside the outreach gate fire the same step events, so every count here is both. Only <b>Pro Upgrade - Flow Started</b> and its <code>source</code> tell them apart.',
    ],
    steps: [
      {
        id: 'interstitial',
        t: 'Join Pro to send this campaign',
        state: 'ok',
        evs: [
          'Pro Upgrade - Upgrade Interstitial Viewed',
          'Pro Upgrade - Upgrade Interstitial Completed',
          'Pro Upgrade - Upgrade Interstitial Dismissed',
        ],
        note: [
          'drift',
          'Renamed on 10-01',
          'These replaced <b>Pro Upgrade - Interstitial Viewed</b>, <b>Interstitial: Click join</b> and <b>Interstitial: Click maybe later</b>. The snapshot predates the rename. Shown only when the gate opens from a save.',
        ],
      },
      {
        id: 'guidance',
        t: "Let's gather a few things to unlock Pro",
        state: 'ok',
        evs: [
          'Pro Upgrade - Guidance Viewed',
          "Pro Upgrade - Guidance: Click let's go",
        ],
        note: [
          'drift',
          'Name gap',
          'The event says <b>let’s go</b>; the button says <b>Continue</b>.',
        ],
      },
      {
        id: 'status',
        t: 'Are you officially filed?',
        state: 'ok',
        evs: [
          'Pro Upgrade - Filing Status Viewed',
          'Pro Upgrade - Filing Status: Click already filed',
          'Pro Upgrade - Filing Status: Click not yet filed',
        ],
      },
      {
        id: 'filing-instructions',
        t: 'You are not eligible for Pro yet, but here is how to file for this election',
        state: 'ok',
        evs: [
          'Pro Upgrade - Filing Instructions Viewed',
          'Pro Upgrade - Filing Instructions: Click email this to me',
          'Pro Upgrade - Filing Instructions: Click continue to dashboard',
        ],
        note: [
          'warn',
          'A dead end, for No',
          'Answering No lands here and the flow does not rejoin: Back returns to the question, <b>Finish later</b> leaves (and fires the event named continue to dashboard).',
        ],
      },
      {
        id: 'ein',
        t: 'What is your campaign EIN?',
        state: 'ok',
        evs: [
          'Pro Upgrade - EIN Viewed',
          'Pro Upgrade - EIN: Click continue',
          'Pro Upgrade - EIN: Click email me these steps',
        ],
      },
      {
        id: 'payment',
        t: 'Complete your upgrade',
        state: 'ok',
        evs: ['Pro Upgrade - Payment Viewed'],
        note: [
          'warn',
          'Open without close',
          'Nothing fires on confirm. <b>Success Viewed</b> is the only proxy for a completed payment.',
        ],
      },
      {
        id: 'success',
        t: 'Welcome to Pro',
        state: 'ok',
        evs: [
          'Pro Upgrade - Success Viewed',
          'Pro Upgrade - Success: Click continue',
        ],
      },
    ],
    offstep: {
      title: 'Opening the flow, and the subscription',
      evs: [
        'Pro Upgrade - Flow Started',
        'Account - Pro Subscription Confirmed',
      ],
    },
  }

  const OUTREACH_GATE = {
    kind: 'page',
    name: 'Outreach gate',
    route: '/dashboard/outreach',
    src: 'packages/gp-webapp/app/dashboard/outreach/v2/gate/OutreachGate.tsx + useOutreachGate.ts',
    note: 'not a sequence: one screen chosen by what the account still needs before it can send',
    intro: [
      'warn',
      'Behind a flag, and silent so far',
      'The gate shows only under <b>outreach-pro-gating-v2</b>. Every event only the gate fires is never observed or newer than the snapshot. The Pro and verification screens are their own flows on this map, and their counts are mostly from elsewhere.',
    ],
    zones: [
      {
        id: 'entry',
        t: 'The banner and explainer inside a wizard',
        state: 'ok',
        evs: [
          'Outreach - Gate Banner Viewed',
          'Outreach - Gate Explainer Viewed',
          'Outreach - Gate Explainer: Click CTA',
          'Outreach - Draft Saved',
        ],
      },
      {
        id: 'pro',
        t: 'Pro: the Pro upgrade flow, purchase only',
        state: 'ok',
        evs: ['Pro Upgrade - Flow Started'],
      },
      {
        id: 'verify',
        t: 'Verify (text only): the campaign verification steps',
        state: 'ok',
        evs: ['Pro Upgrade - Verification Intro Viewed'],
      },
      {
        id: 'pin',
        t: 'Enter your PIN (text only)',
        state: 'ok',
        evs: [
          'Pro Upgrade - PIN Entry Viewed',
          '10 DLC Compliance - PIN Verification Completed',
        ],
      },
      {
        id: 'in_review',
        t: 'Verification in review (text only)',
        state: 'ok',
        evs: ['Outreach - Gate In Review Viewed'],
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
          route: '/onboarding/office-selection',
          inMap: false,
          surfaces: [WIN_ONBOARDING, FOLLOW_ON],
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
            ROBOCALL_WIZARD,
            SOCIAL_WIZARD,
            OUTREACH_GATE,
            building(
              'Phone banking wizard',
              '/dashboard/outreach',
              'packages/gp-webapp/app/dashboard/outreach/v2/phone-banking/PhoneBankingFlow.tsx',
              'on the same shell as SMS, with a separate step order for an event invite',
            ),
          ],
        },
        {
          name: 'Voter Data',
          route: '/dashboard/contacts',
          inMap: true,
          surfaces: [
            building(
              'Create a list',
              '/dashboard/contacts',
              'packages/gp-webapp/app/dashboard/contacts/crm/wizard/CreateListWizard.tsx',
              'has its own per-stage List Wizard events',
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
          surfaces: [WEBSITE_CREATE, WEBSITE_EDITOR],
        },
        {
          name: 'Pro upgrade',
          route: '/dashboard/pro-upgrade',
          inMap: true,
          surfaces: [PRO_UPGRADE],
        },
        {
          name: 'Campaign verification',
          route: '/dashboard/campaign-verification',
          inMap: true,
          surfaces: [CAMPAIGN_VERIFICATION],
        },
        {
          name: 'Door knocking',
          route: '/dashboard/door-knocking',
          inMap: true,
          surfaces: [DOOR_KNOCKING],
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
          surfaces: [ORDINANCE],
        },
        {
          name: 'Polls',
          route: '/dashboard/polls',
          inMap: true,
          surfaces: [
            building(
              'Create a poll',
              '/dashboard/polls/create',
              'packages/gp-webapp/app/dashboard/polls/create/CreatePoll.tsx',
              'declared as an order array; shares Payment - Completed with expanding a poll',
            ),
            POLL_EXPAND,
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

  function evRow(name, opts, ctx, propVal, propKey) {
    const forceUnclean = opts && opts.unclean
    const e = EV[name]
    if (!e)
      return `<details class="evd" data-clean="0"><summary class="ev"><i class="evdot dormant"></i><span class="mevname">${esc(name)}</span><span class="tag warn">not in snapshot</span></summary></details>`
    const st = e[0],
      tags = []
    if (propVal) tags.push(['ok', (propKey || 'step') + ' = ' + propVal])
    if (forceUnclean) tags.push(['warn', 'anchor disagrees'])
    if (opts && opts.legacy && name.startsWith(opts.legacy))
      tags.push(['drift', 'legacy'])
    const A = ANCHOR[e[10]]
    if (A) tags.push([A[0], A[1]])
    const card = (DATA.event_cards || {})[name]
    if (card && (card.okr_metrics || []).some((m) => !m.historical))
      tags.push(['okr', 'OKR'])
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
      ? `<div class="evs">${shared.map(([n, v, k]) => evRow(n, s, ctx, v, k)).join('')}</div>
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
  // Plain-language glossary for readers outside analytics: every badge, tag and count
  // the map renders. Keep it in step when a label is added or renamed.
  const GLOSSARY = `<details class="glossary">
  <summary>What the labels mean</summary>
  <p class="gintro">This page shows the screens people go through in our product, and for each one, whether we record what they do there. A recorded action is an <b>event</b>, for example "Pledge Viewed" when someone opens the pledge screen.</p>
  <div class="ggrid">
    <section>
      <h4>The building blocks</h4>
      <dl>
        <dt>Flow</dt><dd>Screens people go through in order, like onboarding. Each screen is a numbered <b>step</b>.</dd>
        <dt>Page</dt><dd>One screen with several parts that can appear in any order, like the dashboard. Each part is a <b>zone</b>.</dd>
        <dt>Event</dt><dd>One action we record, with how many times it happened in the last 30 days.</dd>
        <dt>Still being built</dt><dd>We know this flow exists but have not drawn its steps on this map yet.</dd>
      </dl>
    </section>
    <section>
      <h4>Is the event working?</h4>
      <dl>
        <dt>Active</dt><dd>It is recording normally. These rows carry no label.</dd>
        <dt>Never observed</dt><dd>The code to record it exists, but it has never recorded anything. Often the feature is switched off, or nobody has reached it yet.</dd>
        <dt>Dormant</dt><dd>It used to record and has gone quiet.</dd>
        <dt>Retired, deprecating</dt><dd>We stopped using it on purpose, or are about to.</dd>
        <dt>Orphaned firing</dt><dd>Still recording after we removed the code that sends it. Worth looking into.</dd>
        <dt>Code unknown</dt><dd>It records, but we could not find where in our code it comes from.</dd>
        <dt>System</dt><dd>Recorded automatically by our analytics tool, not by our own code.</dd>
        <dt>Not in snapshot</dt><dd>It was added or renamed after this page's data was last refreshed. It appears on the next refresh.</dd>
        <dt>Legacy</dt><dd>An older version of an event that still records next to its replacement.</dd>
        <dt>OKR</dt><dd>One of the company goal numbers is built on this event.</dd>
      </dl>
    </section>
    <section>
      <h4>Do we know where it happens?</h4>
      <p class="gnote">Separately from recording the action, we keep a note of which web page it happens on. That note is called an <b>anchor</b>.</p>
      <dl>
        <dt>No anchor</dt><dd>The event records fine, but we have no note of which page it happens on. A gap in our records, not a broken feature.</dd>
        <dt>Call site unknown</dt><dd>We have a note, but could not find the line of code that sends it.</dd>
        <dt>No route</dt><dd>It does not belong to any one page, for example something recorded by our servers.</dd>
        <dt>Anchor disagrees</dt><dd>Our note says one page, but the event's own description says another.</dd>
      </dl>
    </section>
    <section>
      <h4>The counts on each flow</h4>
      <dl>
        <dt>N events</dt><dd>How many different actions we record anywhere in this flow.</dd>
        <dt>Steps with none</dt><dd>Screens where we record nothing, so we cannot tell how many people saw them or left there.</dd>
        <dt>Unplaceable</dt><dd>Events in this flow we cannot tie to a page, because of the anchor gaps above.</dd>
        <dt>Overlapping</dt><dd>Steps where an old and a new version of the same events both record, which can double count.</dd>
        <dt>Misanchored</dt><dd>Events whose page note points somewhere other than where they really happen.</dd>
        <dt>Relabel</dt><dd>Suggested name changes for how an event is displayed. The underlying name stays, so reports keep working.</dd>
      </dl>
    </section>
    <section>
      <h4>Other labels</h4>
      <dl>
        <dt>step = audience</dt><dd>One event covers several steps, and a detail sent with it says which step. Its count is for all steps together.</dd>
        <dt>Declared in productMap</dt><dd>This area is on the list our in-product assistants use to tell people where things are, and a check keeps that list up to date.</dd>
        <dt>Not in productMap</dt><dd>The assistants cannot point people here, and nothing checks this area when it changes. Onboarding is the main example.</dd>
      </dl>
    </section>
  </div>
</details>`
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
    </div>` +
      GLOSSARY
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

  const BUILDING_COUNT = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'][
    TREE.flatMap((p) => p.areas)
      .flatMap((a) => a.surfaces)
      .filter((f) => f.building).length
  ]
  const BUILDING_NOTE = `<div class="building">
  <h3>Still being built</h3>
  <p>This is a first version, shared to find out what you can do with it. What is not finished:</p>
  <ul>
    <li><b>${BUILDING_COUNT} flows are placed but not yet drawn.</b> Each sits under its area above with a "Still being built" tag and opens to the file its steps live in; each needs its step list read out of the code once.</li>
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
