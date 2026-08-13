import { expect, test, type Page, type Request } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import { setupProCampaignUser } from 'src/helpers/organizations'
import {
  activityPill,
  activityPillGroup,
  closeCrmSheet,
  selectActivityPill,
  crmSheet,
  enableCrmFlags,
  gotoCrmContacts,
  listCard,
  saveWizardList,
  statTileValue,
  wizardBuildButton,
} from 'src/helpers/crm-contacts-e2e'

// ENG-10757: end-to-end coverage of the create-list wizard's outreach-activity
// branch (Win-only — Serve drops the branch chooser entirely, ENG-10750).
//
// Data reality this spec is honest about:
//   - Counts and the create run against the REAL gp-api resolution engine
//     (POST /v1/contacts/count, POST /v1/voters/voter-file/filter) for a
//     freshly provisioned org with ZERO outreach history, so every count is 0.
//     Zero is the CORRECT resolution result for activity conditions on an
//     unseeded org (interactions are org-scoped), so the spec asserts "(0)"
//     as a real round-trip, and pins the request payloads field-by-field —
//     the contract the resolution engine consumes.
//   - The ONE stub is GET /v1/outreach: completed-campaign chips cannot exist
//     otherwise, because an outreach cannot be launched from e2e. The stubbed
//     id is used only for a count-payload assertion, never for the create —
//     gp-api's validateActivityConditions 400s a create whose outreachId
//     doesn't exist for the org.
//   - The resolution SQL itself (channel tables → person-id sets → in/notIn)
//     is covered by gp-api integration tests:
//     packages/gp-api/src/contactInteraction/tests/activityConditionResolution.service.test.ts
//     and packages/gp-api/src/voters/voterFile/voterFile.filter.routes.test.ts.
//   - The locked-filter path (edit/delete 409 once firstUsedForOutreachAt is
//     stamped) needs a real outreach launch and is out of e2e reach; it is
//     covered by packages/gp-api/src/voters/services/voterFileFilter.service.test.ts.
//
// Reaching the wizard requires a Pro Win campaign; setupProCampaignUser flips
// isPro via the test-only endpoint (no Stripe webhook), so this runs on PRs.

const TEST_TIMEOUT = 15 * 60 * 1000

const COMPLETED_TEXT_OUTREACH_ID = 987654

// The wizard's campaign chips render only completed outreaches of the
// condition's own channel; the draft text and the completed robocall exist to
// prove both filters.
const STUBBED_OUTREACHES = [
  {
    id: COMPLETED_TEXT_OUTREACH_ID,
    outreachType: 'text',
    status: 'completed',
    name: 'Weekend GOTV Text',
  },
  {
    id: 987655,
    outreachType: 'text',
    status: 'pending',
    name: 'Draft Text Blast',
  },
  {
    id: 987656,
    outreachType: 'robocall',
    status: 'completed',
    name: 'Election Eve Robocall',
  },
]

type ActivityConditionPayload = {
  outreachType: string
  outreachId: number | null
  actions: string[]
}

type CountRequestPayload = {
  activityConditions?: ActivityConditionPayload[]
}

// Arm BEFORE the pill click that triggers the (600ms-debounced) count, so the
// request can't fire before the waiter exists. Matching on payload content
// keeps an earlier still-in-flight count from satisfying a later step's wait.
const armCountRequestWait = (
  page: Page,
  matches: (conditions: ActivityConditionPayload[]) => boolean,
): Promise<ActivityConditionPayload[]> =>
  page
    .waitForRequest((request: Request) => {
      if (request.method() !== 'POST') return false
      if (!request.url().includes('/api/v1/contacts/count')) return false
      const payload = request.postDataJSON() as CountRequestPayload
      return (
        Array.isArray(payload.activityConditions) &&
        matches(payload.activityConditions)
      )
    })
    .then(
      (request) =>
        (request.postDataJSON() as CountRequestPayload).activityConditions!,
    )

test.describe('Contacts activity filters', () => {
  // The production build's service worker fetches same-origin GETs from inside
  // the worker, where page.route never sees them — the GET /v1/outreach stub
  // would silently leak to the real API (see crm-assistant-bar.spec.ts).
  test.use({ serviceWorkers: 'block' })

  test('activity branch: conditions, payload contract, save, detail round-trip', async ({
    page,
  }) => {
    test.setTimeout(TEST_TIMEOUT)
    await blockSlowScripts(page)
    await enableCrmFlags(page)

    await setupProCampaignUser(page)

    await page.route(/\/api\/v1\/outreach(\?|$)/, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: STUBBED_OUTREACHES })
        : route.fallback(),
    )

    await gotoCrmContacts(page)
    await expect(page.getByRole('heading', { name: 'Voter Data' })).toBeVisible(
      { timeout: 20_000 },
    )

    const wizard = crmSheet(page)
    const build = wizardBuildButton(page)
    const channelGroups = activityPillGroup(wizard, 'Previous activity')

    await test.step('branch step: choose the outreach-activity branch', async () => {
      await page.getByRole('button', { name: 'Create new list' }).click()
      await expect(wizard).toBeVisible({ timeout: 15_000 })
      await expect(
        wizard.getByText('How do you want to build this list?'),
      ).toBeVisible({ timeout: 10_000 })
      await expect(wizard.getByText('Step 1 of 3')).toBeVisible()

      const continueButton = wizard.getByRole('button', { name: 'Continue' })
      await expect(continueButton).toBeDisabled()
      await wizard
        .getByText('Build a list from previous campaign activity')
        .click()
      await expect(continueButton).toBeEnabled()
      await continueButton.click()
    })

    await test.step('empty condition: channel vocabulary, Build disabled', async () => {
      await expect(
        wizard.getByText('Build a voter list', { exact: true }),
      ).toBeVisible({ timeout: 10_000 })
      await expect(channelGroups.first()).toBeVisible({ timeout: 10_000 })

      for (const channel of ['Text', 'Door Knocking', 'Robocall']) {
        await expect(activityPill(channelGroups.first(), channel)).toBeVisible()
      }
      // No channel chosen yet: the campaign and outcome rows don't exist, the
      // lone condition's trash is disabled, and Build is disabled (a condition
      // without a channel is invalid — ENG-10757 AC).
      await expect(activityPillGroup(wizard, 'Campaign')).toHaveCount(0)
      await expect(activityPillGroup(wizard, 'Activity')).toHaveCount(0)
      await expect(
        wizard.getByRole('button', { name: 'Remove condition 1' }),
      ).toBeDisabled()
      await expect(build).toBeDisabled()
    })

    const campaignGroup = activityPillGroup(wizard, 'Campaign')

    await test.step('channel Text: count fires, campaign chips are channel-scoped', async () => {
      const countRequest = armCountRequestWait(
        page,
        (conditions) => conditions.length === 1,
      )
      await selectActivityPill(channelGroups.first(), 'Text')
      expect(await countRequest).toEqual([
        { outreachType: 'text', outreachId: null, actions: [] },
      ])

      // Real resolution round-trip: this org has no outreach history, so zero
      // is the CORRECT count for any activity condition (see header comment).
      // The CTA is never enabled on this org: it shows the loading state
      // while counting (86ajrth65) and a settled zero keeps it disabled
      // (ENG-10781) — the old enabled-while-counting window is gone.
      await expect(build).toContainText('(0)', { timeout: 30_000 })
      await expect(build).toBeDisabled()

      // "Any campaign" is the default; only the COMPLETED TEXT outreach joins
      // it — the pending text and the completed robocall are filtered out.
      await expect(campaignGroup).toBeVisible()
      await expect(activityPill(campaignGroup, 'Any campaign')).toHaveAttribute(
        'data-state',
        'on',
      )
      await expect(
        activityPill(campaignGroup, 'Weekend GOTV Text'),
      ).toBeVisible()
      await expect(activityPill(campaignGroup, 'Draft Text Blast')).toHaveCount(
        0,
      )
      await expect(
        activityPill(campaignGroup, 'Election Eve Robocall'),
      ).toHaveCount(0)
    })

    await test.step('outcomes: progressive reveal, text vocabulary, payload carries the action', async () => {
      await expect(activityPillGroup(wizard, 'Activity')).toHaveCount(0)
      await wizard.getByRole('button', { name: 'Filter on activity' }).click()

      const outcomeGroup = activityPillGroup(wizard, 'Activity')
      await expect(outcomeGroup).toBeVisible()
      for (const outcome of ['Responded', 'No Response', 'Opted Out']) {
        await expect(activityPill(outcomeGroup, outcome)).toBeVisible()
      }
      // Door-knock outcomes must not bleed into the text vocabulary.
      await expect(activityPill(outcomeGroup, 'Not Home')).toHaveCount(0)

      const countRequest = armCountRequestWait(page, (conditions) =>
        conditions.some((condition) => condition.actions.length > 0),
      )
      await selectActivityPill(outcomeGroup, 'No Response')
      expect(await countRequest).toEqual([
        { outreachType: 'text', outreachId: null, actions: ['no_response'] },
      ])
    })

    await test.step('specific campaign vs any: outreachId rides the payload', async () => {
      const countRequest = armCountRequestWait(page, (conditions) =>
        conditions.some((condition) => condition.outreachId !== null),
      )
      await selectActivityPill(campaignGroup, 'Weekend GOTV Text')
      expect(await countRequest).toEqual([
        {
          outreachType: 'text',
          outreachId: COMPLETED_TEXT_OUTREACH_ID,
          actions: ['no_response'],
        },
      ])
      await expect(build).toContainText('(0)', { timeout: 30_000 })

      // Back to "any campaign" before saving: the create endpoint validates
      // outreachId existence against the org's real outreaches, and this id
      // only exists in the GET /v1/outreach stub.
      await selectActivityPill(campaignGroup, 'Any campaign')
    })

    await test.step('second condition: incomplete row disables Build, door-knock shape, AND-composition', async () => {
      await wizard.getByRole('button', { name: 'Add condition' }).click()
      await expect(channelGroups).toHaveCount(2)
      // Every condition must carry a channel — one incomplete row invalidates
      // the whole step again.
      await expect(build).toBeDisabled()
      // With two conditions both rows become removable.
      await expect(
        wizard.getByRole('button', { name: 'Remove condition 1' }),
      ).toBeEnabled()
      await expect(
        wizard.getByRole('button', { name: 'Remove condition 2' }),
      ).toBeEnabled()

      const countRequest = armCountRequestWait(
        page,
        (conditions) => conditions.length === 2,
      )
      await selectActivityPill(channelGroups.nth(1), 'Door Knocking')
      expect(await countRequest).toEqual([
        { outreachType: 'text', outreachId: null, actions: ['no_response'] },
        { outreachType: 'doorKnocking', outreachId: null, actions: [] },
      ])
      await expect(build).toContainText('(0)', { timeout: 30_000 })

      // Door-knock interactions have no outreach linkage, so the second
      // condition renders no campaign row — still exactly one on the step.
      await expect(campaignGroup).toHaveCount(1)

      // Condition 1's outcomes stay revealed (it has a selection), so the one
      // remaining reveal button belongs to condition 2 — door vocabulary.
      await wizard.getByRole('button', { name: 'Filter on activity' }).click()
      const outcomeGroups = activityPillGroup(wizard, 'Activity')
      await expect(outcomeGroups).toHaveCount(2)
      for (const outcome of [
        'Answered',
        'Not Home',
        'Refused to Engage',
        'Support: Yes',
        'Support: Unsure',
        'Support: No',
      ]) {
        await expect(activityPill(outcomeGroups.nth(1), outcome)).toBeVisible()
      }

      const bothWithActions = armCountRequestWait(
        page,
        (conditions) =>
          conditions.length === 2 &&
          conditions.every((condition) => condition.actions.length > 0),
      )
      await selectActivityPill(outcomeGroups.nth(1), 'Not Home')
      expect(await bothWithActions).toEqual([
        { outreachType: 'text', outreachId: null, actions: ['no_response'] },
        {
          outreachType: 'doorKnocking',
          outreachId: null,
          actions: ['not_home'],
        },
      ])
      await expect(build).toContainText('(0)', { timeout: 30_000 })
      // ENG-10781: a settled zero-match count disables Build end-to-end.
      await expect(build).toBeDisabled()
    })

    const listName = `E2E activity ${Date.now()}`

    await test.step('save: create payload asserted field-by-field', async () => {
      // This org resolves the not_home refinement to zero people and the
      // ENG-10781 gate blocks saving a zero-match list outright. Stub a
      // nonzero count for the save leg — the payload contract, not the
      // number, is what the rest of this spec pins. The added outcome must
      // be one this spec has never counted before: the app's React Query
      // staleTime is 5 minutes, so a payload that was already counted
      // (e.g. toggling the same pill off and on) serves the cached zero
      // and the stub never fires.
      const outcomeGroups = activityPillGroup(wizard, 'Activity')
      await page.route(/\/api\/v1\/contacts\/count(\?|$)/, (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({ json: { count: 3 } })
          : route.fallback(),
      )
      await selectActivityPill(outcomeGroups.nth(1), 'Answered')
      await expect(build).toContainText('(3)', { timeout: 30_000 })
      await expect(build).toBeEnabled()

      await build.click()
      await expect(wizard.getByText('Name your list')).toBeVisible({
        timeout: 10_000,
      })

      const createRequestPromise = page.waitForRequest(
        (request: Request) =>
          request.method() === 'POST' &&
          /\/api\/v1\/voters\/voter-file\/filter(\?|$)/.test(request.url()),
      )
      await saveWizardList(page, listName)

      // Exact body equality: the activity branch must send activityConditions
      // and the name — and nothing else (no demographic keys riding along).
      const createBody = (await createRequestPromise).postDataJSON() as {
        name: string
        activityConditions: ActivityConditionPayload[]
      }
      expect(createBody).toEqual({
        name: listName,
        activityConditions: [
          { outreachType: 'text', outreachId: null, actions: ['no_response'] },
          {
            outreachType: 'doorKnocking',
            outreachId: null,
            actions: ['not_home', 'answered'],
          },
        ],
      })
    })

    await test.step('detail round-trip: summary sentence + zero-people tiles + list card', async () => {
      const detailSheet = crmSheet(page)
      await expect(
        detailSheet.getByText(listName, { exact: true }),
      ).toBeVisible({ timeout: 20_000 })
      // The persisted segment (not the request) drives the summary — this pins
      // the create → refresh → detail round-trip for activityConditions.
      await expect(
        detailSheet.getByText(
          'Text activity from any text campaign with outcome No Response ' +
            'and Door Knocking activity from any door knocking campaign ' +
            'with outcome Not Home or Answered.',
        ),
      ).toBeVisible({ timeout: 30_000 })
      await expect(statTileValue(detailSheet, 'People')).toHaveText('0', {
        timeout: 30_000,
      })

      await closeCrmSheet(page)
      await expect(listCard(page, listName)).toBeVisible({ timeout: 20_000 })
    })
  })
})
