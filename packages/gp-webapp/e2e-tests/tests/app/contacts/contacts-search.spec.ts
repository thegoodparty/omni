import { expect, test } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import {
  enableCrmFlags,
  fetchListMembers,
  fullPersonName,
  gotoCrmContacts,
  typeaheadInput,
  type ContactsApiPerson,
} from 'src/helpers/crm-contacts-e2e'
import { personContactPanel } from 'src/helpers/contacts-e2e'
import {
  setupElectedOfficeUser,
  switchOrganization,
  getSelectedOrgName,
  getOrgPickerOptions,
} from 'src/helpers/organizations'

// @dev-only: contact search is reachable only for a pro campaign org (gp-api
// findContacts hard-rejects search requests for non-pro), and the search
// needs the warm dev stack's real district voter data. Same gating as
// win-contacts.spec.ts. The CI workflow greps @dev-only out on pull_request
// runs and includes it post-merge on develop. See e2e-tests/CLAUDE.md.
//
// ENG-10756 port: the flag-on CRM page replaces the "Search contacts" box +
// member table with the persistent typeahead (crm/ContactTypeahead.tsx), so
// "the matching row appears in the table" becomes "the exact person appears
// as a typeahead result" — matched by the result's person-id data-value, so
// a same-named neighbor can't satisfy the assertion.
test.describe('Voter Data contact search @dev-only', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
    await enableCrmFlags(page)
  })

  test('full-name, case-insensitive, and partial search surface the matching person', async ({
    page,
  }) => {
    test.setTimeout(3 * 60 * 1000)

    // setupElectedOfficeUser leaves the EO org selected; the Win context is
    // the campaign (non-eo) org, so switch to it. Mirrors win-contacts.spec.
    const { client } = await setupElectedOfficeUser(page)

    const eoOrgName = await getSelectedOrgName(page)
    const allOrgs = await getOrgPickerOptions(page)
    const campaignOrgName = allOrgs.find((name) => name !== eoOrgName)
    expect(campaignOrgName).toBeTruthy()
    await switchOrganization(page, campaignOrgName!)

    // Repoint the API client at the campaign org too, so the name lookup
    // below reads the same voter universe the page is searching.
    const { data: orgsResponse } = await client.get<{
      organizations: { slug: string }[]
    }>('/v1/organizations')
    const campaignSlug = orgsResponse.organizations.find(
      (org) => !org.slug.startsWith('eo-'),
    )?.slug
    expect(campaignSlug).toBeTruthy()
    client.defaults.headers['x-organization-slug'] = campaignSlug!

    await gotoCrmContacts(page)

    // Read a real name from the base list (the same GET /v1/contacts the
    // legacy table rendered) so the search query is deterministic against the
    // seeded race's live L2 data — a hardcoded name may not exist here. The
    // prefix query below drops one char, so the name must keep >= 3 chars
    // (the typeahead's minimum) after that.
    const people = await fetchListMembers(client, 'all')
    const person = people.find(
      (candidate: ContactsApiPerson) => fullPersonName(candidate).length >= 4,
    )
    expect(person).toBeTruthy()
    const fullName = fullPersonName(person!)

    const input = typeaheadInput(page)
    await expect(input).toBeVisible({ timeout: 20_000 })

    const personOption = page.locator(
      `[data-slot="command-item"][data-value="${person!.id}"]`,
    )

    // Full name, lowercased: case-insensitivity is the ENG-10513 fix under
    // test.
    await input.fill(fullName.toLowerCase())
    await expect(personOption).toBeVisible({ timeout: 30_000 })

    // Partial / prefix query (lowercase): the full name minus its last
    // character still returns the person (case-insensitive prefix + LIKE
    // behavior). Dropping just the last char keeps the query as selective as
    // the full-name search, so the target stays inside the typeahead's
    // 8-result page (see PR #384's review of short-prefix false negatives).
    await input.fill(fullName.toLowerCase().slice(0, -1))
    await expect(personOption).toBeVisible({ timeout: 30_000 })

    // Selecting the result opens the person record — the CRM equivalent of
    // the legacy "click the matching row" step.
    await personOption.click()
    const panel = personContactPanel(page)
    await expect(panel).toBeVisible({ timeout: 15_000 })
    await expect(panel.getByText(fullName, { exact: false })).toBeVisible({
      timeout: 30_000,
    })
  })
})
