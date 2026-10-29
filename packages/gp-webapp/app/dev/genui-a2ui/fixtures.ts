import {
  GENERATED_UI_A2UI_CATALOG_ID,
  GENERATED_UI_SEND_MESSAGE_EVENT,
  type PresentGeneratedUiA2ui,
} from '@goodparty_org/contracts'

const surface = (
  surfaceId: string,
  components: { id: string; component: string; [key: string]: unknown }[],
  dataModel?: Record<string, unknown>,
): PresentGeneratedUiA2ui => ({
  messages: [
    {
      version: 'v0.9',
      createSurface: { surfaceId, catalogId: GENERATED_UI_A2UI_CATALOG_ID },
    },
    { version: 'v0.9', updateComponents: { surfaceId, components } },
    ...(dataModel
      ? [
          {
            version: 'v0.9' as const,
            updateDataModel: { surfaceId, path: '/', value: dataModel },
          },
        ]
      : []),
  ],
})

export const GENUI_A2UI_FIXTURES: {
  name: string
  payload: PresentGeneratedUiA2ui
}[] = [
  {
    name: 'District dashboard (stats bound to the data model, table)',
    payload: surface(
      'dashboard',
      [
        {
          id: 'root',
          component: 'Stack',
          children: ['title', 'intro', 'stats', 'table', 'more'],
        },
        { id: 'title', component: 'Heading', text: 'District 4 at a glance' },
        {
          id: 'intro',
          component: 'Text',
          variant: 'muted',
          text: 'From the 2024 voter file and the last council survey.',
        },
        {
          id: 'stats',
          component: 'Stack',
          direction: 'horizontal',
          children: ['voters', 'turnout', 'replies'],
        },
        {
          id: 'voters',
          component: 'Stat',
          label: 'Registered voters',
          value: { path: '/stats/voters' },
        },
        {
          id: 'turnout',
          component: 'Stat',
          label: 'Turnout in 2024',
          value: { path: '/stats/turnout' },
          delta: '+4 pts since 2020',
        },
        {
          id: 'replies',
          component: 'Stat',
          label: 'Survey replies',
          value: '318',
          caption: 'March council survey',
        },
        {
          id: 'table',
          component: 'Table',
          columns: ['Issue', 'Support', 'Trend'],
          rows: [
            ['Housing costs', '64%', 'Rising'],
            ['Road repair', '52%', 'Flat'],
            ['Library hours', '41%', 'Rising'],
          ],
        },
        {
          id: 'more',
          component: 'ActionButton',
          label: 'Dig into housing',
          action: {
            event: {
              name: GENERATED_UI_SEND_MESSAGE_EVENT,
              context: { text: 'Tell me more about housing costs.' },
            },
          },
        },
      ],
      { stats: { voters: '12,480', turnout: '61%' } },
    ),
  },
  {
    name: 'Map with two places',
    payload: surface('map', [
      {
        id: 'root',
        component: 'MapCard',
        title: 'City Hall and the main library',
        center: { lat: 39.7392, lng: -104.9903 },
        zoom: 14,
        markers: [
          { lat: 39.7393, lng: -104.9901, label: 'City Hall' },
          { lat: 39.7372, lng: -104.9887, label: 'Central Library' },
        ],
      },
    ]),
  },
  {
    name: 'Contact card',
    payload: surface('contact', [
      {
        id: 'root',
        component: 'ContactCard',
        name: 'Jane Rivera',
        role: 'City Clerk',
        organization: 'City of Springfield',
        phone: '555-0142',
        email: 'clerk@example.gov',
        note: 'Runs council agendas and public records requests.',
      },
    ]),
  },
  {
    name: 'Outreach card',
    payload: surface('outreach', [
      {
        id: 'root',
        component: 'OutreachCard',
        channel: 'text',
        audience: 'Seniors near the main library',
        audienceCount: 1240,
        message:
          'Hi, this is your council office. The main library now opens at 9am on weekdays. Reply with questions.',
        ctaLabel: 'Set up the text',
      },
    ]),
  },
  {
    name: 'Choice questions (multi and single, bound to the data model)',
    payload: surface(
      'choices',
      [
        {
          id: 'root',
          component: 'Stack',
          children: ['multi', 'single'],
          gap: 'lg',
        },
        {
          id: 'multi',
          component: 'ChoiceQuestion',
          question: 'Which outreach channels do you want this month?',
          options: ['Text', 'Phone calls', 'Door knocking', 'Social posts'],
          multi: true,
          value: { path: '/channels' },
          submit: {
            event: {
              name: GENERATED_UI_SEND_MESSAGE_EVENT,
              context: { choices: { path: '/channels' } },
            },
          },
        },
        {
          id: 'single',
          component: 'ChoiceQuestion',
          question: 'When should it go out?',
          options: ['This week', 'Next week'],
          value: { path: '/when' },
          submit: {
            event: {
              name: GENERATED_UI_SEND_MESSAGE_EVENT,
              context: { choices: { path: '/when' } },
            },
          },
        },
      ],
      { channels: [], when: [] },
    ),
  },
  {
    name: 'Invalid: unknown component',
    payload: surface('broken', [{ id: 'root', component: 'Chart' }]),
  },
]
