import { expect, test, type Page, type Route } from '@playwright/test'
import { setupElectedOfficeUser } from 'src/helpers/organizations'
import { NavigationHelper } from 'src/helpers/navigation.helper'
import { WaitHelper } from 'src/helpers/wait.helper'

/**
 * A recorded walkthrough of the Serve Priorities feature, for design review.
 *
 * This is a demo harness, not a regression suite. It exists so a reviewer can
 * watch the designs on `feat/serve-priorities-flow` without standing the
 * feature up by hand, and it is deliberately not wired into CI.
 *
 * Two runs, because the flow's content comes from a live agent and the designs
 * do not:
 *
 * - `design walkthrough` scripts the chat endpoints so every card the flow can
 *   render actually renders, in order, fast and deterministically. This is the
 *   one to watch.
 * - `live agent` leaves the chat real and records whatever the agent does with
 *   the first step. Slower, non-deterministic, and the honest picture of what
 *   the flow feels like at 10 to 40 seconds a turn.
 *
 * The priorities themselves are real in both: created through `POST
 * /v1/priorities` against dev gp-api, so the list page is a real SSR render of
 * real rows.
 */

const PRIORITIES_PATH = '/dashboard/priorities'

// The worked example, borrowed from the brief's prototype prompt so the
// recording matches the document the reviewer is reading alongside it.
const SEED_PRIORITIES = [
  {
    title: 'Speeding on Maple Ave near the elementary school',
    description:
      'Cars are coming through the Maple Ave corridor well over the limit at pickup time, and the crossing by the school is the worst of it. I want it slowed down before someone gets hurt.',
    source: 'user_stated',
  },
  {
    title: 'Get the splash pad built at Lincoln Park',
    description:
      'I ran on this. The park has no water feature and the nearest one is a twenty minute drive for families on the east side.',
    source: 'win_import',
  },
  {
    title: 'Update the tree ordinance to add a canopy goal',
    description:
      'Our tree ordinance protects individual trees but sets no target for canopy coverage, so we lose ground every year without anyone noticing.',
    source: 'user_stated',
  },
]

type StubMessage = {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  segments?: { kind: 'text' | 'tool'; text?: string; toolName?: string }[]
}

const CONVERSATION_ID = 'priorities-demo-conversation'

const fence = (payload: unknown): string =>
  '```priority\n' + JSON.stringify(payload) + '\n```'

// One scripted assistant turn: the prose the user reads, the tool pills that
// ran under it, and the directive the client parses into a card.
type ScriptedTurn = { prose: string; tools?: string[]; directive: unknown }

const DEFINE_Q1: ScriptedTurn = {
  prose:
    'Maple Ave is the corridor that carries the school traffic, so who this lands on depends a lot on which part of the day you mean.\n\nI pulled what your district data says about that stretch before asking.',
  tools: ['query_constituent_data', 'count_contacts'],
  directive: {
    ask: 'Who is this landing on hardest right now?',
    options: [
      'Families walking kids to the elementary school',
      'Everyone who lives on the corridor itself',
      'Drivers cutting through from the highway',
    ],
    notes: [
      'About 340 households sit inside the school walk zone, and they are the ones exposed twice a day on a fixed schedule.',
      'Roughly 180 households front Maple directly. They carry the noise and the risk all day, not just at pickup.',
      'This is who causes it rather than who it happens to, so it points at a different fix.',
    ],
  },
}

const DEFINE_Q2: ScriptedTurn = {
  prose:
    'That narrows it. The walk zone is a defined area, which matters later because it is the unit most safe-routes money is awarded against.',
  directive: {
    ask: 'What would you accept as this being solved?',
    options: [
      'Measured speeds drop to the posted limit at pickup',
      'No more near misses reported at the crossing',
      'Physical calming is in the ground on that block',
    ],
    notes: [
      'This is the one you can actually measure before and after, which is what a colleague will ask you for.',
      'Honest goal, but near misses are self reported and your baseline is whatever people happened to call in.',
      'This is a method, not an outcome. Worth wanting, but it decides the answer before you have asked the question.',
    ],
  },
}

const DEFINE_SETTLED: ScriptedTurn = {
  prose:
    'Then here is what we have settled on, in your words, before anything gets built on it.',
  directive: {
    settled:
      'Cars are running above the posted limit on Maple Ave through the elementary school walk zone at pickup. The people it lands on hardest are the roughly 340 households inside that walk zone. Solved means measured speeds at the crossing come down to the posted limit during pickup, measured against a baseline you take first.',
  },
}

const DEFINE_OUTREACH: ScriptedTurn = {
  prose:
    'I built the list of the households inside the walk zone and wrote the question I would put to them. It is 312 people once the contact gate is applied.',
  tools: ['describe_filter_dimensions', 'count_contacts', 'crud_saved_filters'],
  directive: {
    outreach: {
      who: 'Households inside the Maple Ave school walk zone',
      count: 312,
      channel: 'social',
      why: 'These are the people exposed to it on a fixed schedule twice a day, and they are the ones who can tell you whether the crossing or the block is the real problem.',
      message:
        "I'm looking at speeding on Maple Ave by the elementary school. If you walk that stretch, I want to know where it actually feels unsafe: at the crossing itself, or further down the block. Reply and tell me which.",
      listId: 4821,
      listName: 'Maple Ave walk zone',
      campaignName: 'Maple Ave speeding',
    },
  },
}

const DEFINE_ORGS: ScriptedTurn = {
  prose:
    'And the groups who reach the people your contact file does not, which on a school corridor is most of the renters and every family without a landline.',
  tools: ['brave_search', 'fetch_url'],
  directive: {
    orgs: [
      {
        name: 'Maple Elementary PTA',
        why: 'Reaches every family at the school, including renters and non-voters your contact file has no reason to hold.',
        askFor: 'The PTA president or the safety committee chair',
        script:
          "I'm the council member for your ward and I'm working on speeding on Maple Ave at pickup. Before I take anything to council I want to hear from the families who actually walk it. Could you put a short question out to your list, or give me ten minutes at your next meeting?",
        email: 'pta@maple-elementary.example.org',
        phone: '(307) 555-0142',
        url: 'https://maple-elementary.example.org/pta',
      },
      {
        name: 'Cheyenne Safe Streets Coalition',
        why: 'They have already collected speed data on three other corridors, so they can tell you what a defensible baseline looks like.',
        askFor: 'Their volunteer data lead',
        script:
          "I'm looking at traffic calming on Maple Ave near the elementary school. You've done speed counts elsewhere in the city. Would you be willing to walk me through how you took them, so mine hold up when a colleague questions them?",
        email: 'hello@cheyennesafestreets.example.org',
        url: 'https://cheyennesafestreets.example.org',
      },
      {
        name: 'East Side Neighborhood Association',
        why: 'Covers the blocks fronting Maple, and meets in the evening when the people who work days can actually come.',
        askFor: 'Whoever chairs the monthly meeting',
        script:
          'I want to bring the Maple Ave speeding question to your next meeting and hear from people who live on it, not just the people who email me about it. Do you have room on the agenda?',
        phone: '(307) 555-0198',
      },
    ],
  },
}

const EVIDENCE_OPEN: ScriptedTurn = {
  prose:
    '### What is established\nYour district data puts 340 households inside the walk zone, and the corridor is a city street, so this is yours to act on.\n\n### What is likely\nPickup traffic is the peak, based on when the complaints cluster, but nobody has measured it.\n\n### What is not known\nActual speeds. There is no count on this corridor, and that is the claim a colleague will press you on first.',
  tools: ['read_community_issues', 'list_briefings', 'brave_search'],
  directive: {
    ask: 'Which of those is worth closing first?',
    options: [
      'Get an actual speed count on the corridor',
      'Find what the last three calming requests cost the city',
      'Check whether the state has a safe-routes program open',
    ],
    notes: [
      'Without this every other number you bring is an estimate, and you will be asked for it.',
      'Useful for the budget conversation, but it does not tell you whether there is a problem.',
      'Worth knowing, though the application window matters more than the answer right now.',
    ],
  },
}

const EVIDENCE_WAITING: ScriptedTurn = {
  prose:
    'That one you cannot settle in here. Public Works owns the counter and the corridor, so the number has to come from them.',
  directive: {
    waiting: {
      on: 'A speed count on Maple Ave from Public Works',
      unblocks:
        'The baseline every later claim rests on, including whether calming is justified at all',
      when: 'They said two weeks, so after the March 11 meeting',
    },
  },
}

/**
 * Serve the chat endpoints from a script.
 *
 * The flow's own step prompts are what drive it, so the script keys off the
 * content of each hidden ask rather than off a call counter: the client fires
 * the outreach and organizations beats itself, and a counter would drift the
 * moment it did.
 */
const stubChat = async (page: Page): Promise<void> => {
  const transcript: StubMessage[] = []
  let turn = 0
  let defineAnswers = 0

  const replyFor = (content: string): ScriptedTurn => {
    if (content.includes('Now the outreach')) return DEFINE_OUTREACH
    if (content.includes('Now the organizations')) return DEFINE_ORGS
    if (content.includes('[step:evidence]')) return EVIDENCE_OPEN
    if (content.includes('[step:define]')) return DEFINE_Q1
    // Anything else is the user answering the question on screen.
    if (transcript.some((m) => m.content.includes('[step:evidence]'))) {
      return EVIDENCE_WAITING
    }
    defineAnswers += 1
    return defineAnswers === 1 ? DEFINE_Q2 : DEFINE_SETTLED
  }

  await page.route('**/api/v1/chats**', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()

    if (method === 'POST' && url.pathname === '/api/v1/chats') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ conversationId: CONVERSATION_ID }),
      })
    }

    if (method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          conversationId: CONVERSATION_ID,
          messages: transcript,
        }),
      })
    }

    if (method === 'POST' && url.pathname.endsWith('/messages')) {
      const body = request.postDataJSON() as { content: string }
      turn += 1
      transcript.push({
        id: `u-${turn}`,
        conversationId: CONVERSATION_ID,
        role: 'user',
        content: body.content,
        createdAt: new Date().toISOString(),
      })

      const reply = replyFor(body.content)
      const text = `${reply.prose}\n\n${fence(reply.directive)}`
      const assistantId = `a-${turn}`
      transcript.push({
        id: assistantId,
        conversationId: CONVERSATION_ID,
        role: 'assistant',
        content: text,
        createdAt: new Date().toISOString(),
        segments: [
          ...(reply.tools ?? []).map((toolName) => ({
            kind: 'tool' as const,
            toolName,
          })),
          { kind: 'text' as const, text },
        ],
      })

      // The tool pills render in stream order, so they are emitted before the
      // prose the way a real turn produces them.
      const frames: string[] = []
      for (const toolName of reply.tools ?? []) {
        frames.push(JSON.stringify({ type: 'tool_call', toolName }))
        frames.push(JSON.stringify({ type: 'tool_result', toolName }))
      }
      frames.push(JSON.stringify({ type: 'text', delta: text }))
      frames.push(
        JSON.stringify({ type: 'done', assistantMessageId: assistantId }),
      )

      return route.fulfill({
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        },
        body: frames.map((f) => `data: ${f}\n\n`).join(''),
      })
    }

    return route.continue()
  })
}

/** Create the worked-example priorities through the real API. */
const seedPriorities = async (client: {
  post: (path: string, body: unknown) => Promise<{ data: { id: string } }>
}): Promise<string> => {
  const ids: string[] = []
  for (const priority of SEED_PRIORITIES) {
    const { data } = await client.post('/v1/priorities', priority)
    ids.push(data.id)
  }
  const first = ids[0]
  if (!first) throw new Error('No priority was created')
  return first
}

// A beat long enough to read on the recording. The flow is watchable at speed;
// the cards are not.
const beat = async (page: Page, ms = 1800): Promise<void> => {
  await page.waitForTimeout(ms)
}

test.describe.configure({ mode: 'serial' })

test('priorities: design walkthrough', async ({ page }) => {
  test.setTimeout(300_000)

  const { client } = await setupElectedOfficeUser(page)
  const priorityId = await seedPriorities(client)
  await stubChat(page)

  // The list: lane chips, ranked rows, and the seed section below.
  await page.goto(PRIORITIES_PATH, { waitUntil: 'domcontentloaded' })
  await NavigationHelper.dismissOverlays(page)
  await WaitHelper.waitForPageReady(page)
  await expect(
    page.getByRole('heading', { name: 'My priorities' }),
  ).toBeVisible()
  await expect(page.getByText(SEED_PRIORITIES[0]!.title)).toBeVisible()
  await beat(page, 2500)

  // The inline create form.
  await page.getByRole('button', { name: 'Add a priority' }).click()
  await beat(page, 1500)
  await page.keyboard.press('Escape')

  // Filter to one lane, then back, so the chips read as controls.
  await page.getByRole('button', { name: /From your campaign/i }).click()
  await beat(page, 1500)
  await page.getByRole('button', { name: /From your campaign/i }).click()
  await beat(page, 1200)

  // Into the flow.
  await page.goto(`${PRIORITIES_PATH}/${priorityId}`, {
    waitUntil: 'domcontentloaded',
  })
  await expect(
    page.getByRole('heading', { name: SEED_PRIORITIES[0]!.title }),
  ).toBeVisible()

  // Step 1, question one: option cards with the agent's reasoning under each.
  await expect(
    page.getByText('Who is this landing on hardest right now?'),
  ).toBeVisible({ timeout: 30_000 })
  await beat(page, 3000)
  await page.getByText('Families walking kids to the elementary school').click()

  // Question two.
  await expect(
    page.getByText('What would you accept as this being solved?'),
  ).toBeVisible({ timeout: 30_000 })
  await beat(page, 3000)
  await page
    .getByText('Measured speeds drop to the posted limit at pickup')
    .click()

  // The settle: the summary alone, then the confirm through the same picker.
  await expect(page.getByText('What this step settled')).toBeVisible({
    timeout: 30_000,
  })
  await beat(page, 3500)
  await page.getByText('Yes, that is it').click()

  // Beat two: the outreach, already built.
  await expect(page.getByText('Worth hearing from')).toBeVisible({
    timeout: 30_000,
  })
  await beat(page, 3500)

  // Beat three: the coalitions, fired by the client once outreach lands.
  await expect(
    page.getByText('Groups who reach further than your list'),
  ).toBeVisible({ timeout: 30_000 })
  await beat(page, 2500)

  // The org detail sheet: who to ask for, and the script to read them.
  await page.getByRole('button', { name: /Maple Elementary PTA/ }).click()
  await beat(page, 3500)
  await page.keyboard.press('Escape')
  await beat(page, 1000)

  // The handoff: the channel's own flow opens over the conversation with the
  // message already in it.
  await page.getByRole('button', { name: 'Reach out to them' }).click()
  // The drawer carries an sr-only title alongside the visible one, so this
  // matches twice; the visible heading is the second.
  await expect(page.getByText('What do you want to say?').last()).toBeVisible({
    timeout: 20_000,
  })
  await beat(page, 4000)
  // Leaving a flow that has a draft in it asks before discarding, which is the
  // right behaviour and the reason Escape alone does not close this.
  await page.getByRole('button', { name: 'Exit' }).click()
  await page.getByRole('button', { name: 'Discard' }).click()
  await beat(page, 1500)

  // Continue only appears once the last beat has landed, and its label comes
  // from the destination step.
  const advance = page.getByRole('button', { name: /See what we know/i })
  await expect(advance).toBeVisible()
  await beat(page, 1500)
  await advance.click()

  // Step 2: the evidence card, written as established / likely / not known.
  await expect(
    page.getByText('Which of those is worth closing first?'),
  ).toBeVisible({ timeout: 30_000 })
  await beat(page, 4000)
  await page.getByText('Get an actual speed count on the corridor').click()

  // A step that cannot be finished in the app, recorded rather than forced.
  await expect(page.getByText('Waiting on')).toBeVisible({ timeout: 30_000 })
  await beat(page, 4000)
})

test('priorities: live agent', async ({ page }) => {
  test.setTimeout(300_000)

  const { client } = await setupElectedOfficeUser(page)
  const priorityId = await seedPriorities(client)

  await page.goto(`${PRIORITIES_PATH}/${priorityId}`, {
    waitUntil: 'domcontentloaded',
  })
  await NavigationHelper.dismissOverlays(page)

  await expect(
    page.getByRole('heading', { name: SEED_PRIORITIES[0]!.title }),
  ).toBeVisible()

  // The real first turn: a full agent turn with research behind it. What is
  // worth watching here is how long the step sits on "Thinking..." before
  // anything appears, and whether the turn comes back on contract.
  await expect(page.getByText(/Thinking|Still working on it/)).toBeVisible({
    timeout: 20_000,
  })
  await beat(page, 60_000)
  await page.screenshot({
    path: 'test-results/priorities-live-agent.png',
    fullPage: true,
  })
})
