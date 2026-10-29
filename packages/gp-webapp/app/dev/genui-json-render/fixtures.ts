import type { GeneratedUiSpec } from '@goodparty_org/contracts'

export const GENUI_FIXTURES: { name: string; spec: GeneratedUiSpec }[] = [
  {
    name: 'District dashboard',
    spec: {
      root: 'main',
      elements: {
        main: {
          type: 'Stack',
          props: { gap: 'large' },
          children: ['title', 'stats', 'issues-title', 'issues', 'footnote'],
        },
        title: {
          type: 'Heading',
          props: { text: 'Ward 3 at a glance', level: 'title' },
          children: [],
        },
        stats: {
          type: 'Stack',
          props: { direction: 'horizontal' },
          children: ['stat-residents', 'stat-turnout', 'stat-requests'],
        },
        'stat-residents': {
          type: 'Stat',
          props: {
            label: 'Residents',
            value: '18,240',
            caption: '2020 census',
          },
          children: [],
        },
        'stat-turnout': {
          type: 'Stat',
          props: {
            label: 'Last turnout',
            value: '41%',
            delta: '+6 pts since 2021',
          },
          children: [],
        },
        'stat-requests': {
          type: 'Stat',
          props: {
            label: 'Open 311 requests',
            value: '127',
            delta: '-12 this month',
          },
          children: [],
        },
        'issues-title': {
          type: 'Heading',
          props: { text: 'Top local issues', level: 'section' },
          children: [],
        },
        issues: {
          type: 'Table',
          props: {
            columns: ['Issue', 'Mentions', 'Trend'],
            rows: [
              ['Road repair', '212', 'Rising'],
              ['Library hours', '148', 'Steady'],
              ['Park safety', '96', 'Falling'],
            ],
          },
          children: [],
        },
        footnote: {
          type: 'Text',
          props: {
            text: 'Sample numbers for the playground.',
            variant: 'muted',
          },
          children: [],
        },
      },
    },
  },
  {
    name: 'Map',
    spec: {
      root: 'map',
      elements: {
        map: {
          type: 'MapCard',
          props: {
            title: 'City Hall and the main library',
            center: { lat: 39.7392, lng: -104.9903 },
            zoom: 14,
            markers: [
              { lat: 39.7393, lng: -104.9876, label: 'Denver City Hall' },
              {
                lat: 39.7372,
                lng: -104.9876,
                label: 'Denver Central Library',
              },
            ],
          },
          children: [],
        },
      },
    },
  },
  {
    name: 'Contact card',
    spec: {
      root: 'contact',
      elements: {
        contact: {
          type: 'ContactCard',
          props: {
            name: 'Jane Rivera',
            role: 'City Clerk',
            organization: 'City of Springfield',
            phone: '555-0142',
            email: 'clerk@example.gov',
            note: 'Handles records requests and council agendas.',
          },
          children: [],
        },
      },
    },
  },
  {
    name: 'Choice question (state binding)',
    spec: {
      root: 'question',
      elements: {
        question: {
          type: 'ChoiceQuestion',
          props: {
            question: 'Which outreach channels do you want to use this month?',
            options: ['Text', 'Phone calls', 'Door knocking', 'Social posts'],
            multi: true,
            value: { $bindState: '/answers/channels' },
          },
          children: [],
          on: {
            submit: {
              action: 'submit_choices',
              params: { choices: { $state: '/answers/channels' } },
            },
          },
        },
      },
      state: { answers: { channels: [] } },
    },
  },
  {
    name: 'Outreach card and next step',
    spec: {
      root: 'main',
      elements: {
        main: {
          type: 'Stack',
          props: {},
          children: ['outreach', 'next'],
        },
        outreach: {
          type: 'OutreachCard',
          props: {
            channel: 'text',
            audience: 'Seniors near the main library',
            audienceCount: 1240,
            messagePreview:
              'The main library is now open until 8pm on weekdays. Reply STOP to opt out.',
            ctaLabel: 'Set up the text',
          },
          children: [],
        },
        next: {
          type: 'ActionButton',
          props: {
            label: 'Draft a social post too',
            message: 'Draft a social post about the new library hours.',
          },
          children: [],
        },
      },
    },
  },
]
