import { useState } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PhoneBankingListEntry } from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import PhoneBankingEntryPanel from './PhoneBankingEntryPanel'

const SCRIPT_WITH_TOKEN =
  'Hi, is this [voter name]? My name is [your name], a volunteer.'

const buildEntry = (
  overrides: Partial<PhoneBankingListEntry> = {},
): PhoneBankingListEntry => ({
  id: 1,
  seq: 1,
  sheetIndex: 1,
  phone: '5551110001',
  persons: [
    {
      personId: 'person-1',
      name: 'Alex Solo',
      firstName: 'Alex',
      age: 40,
      party: 'D',
      address: '1 Main St',
      cellPhone: '5551110001',
      landline: null,
      interaction: null,
    },
  ],
  ...overrides,
})

const noop = vi.fn()

beforeEach(() => {
  // The panel always mounts PhoneBankingNotes for the active person.
  api.mock('GET /v1/contacts/:personId/notes', {
    status: 200,
    data: { results: [] },
  })
})

const renderPanel = (
  overrides: Partial<React.ComponentProps<typeof PhoneBankingEntryPanel>> = {},
) =>
  render(
    <PhoneBankingEntryPanel
      listId={42}
      script={SCRIPT_WITH_TOKEN}
      entry={buildEntry()}
      entryIndex={1}
      activePersonId="person-1"
      onActivePersonChange={noop}
      onPrev={noop}
      onNext={noop}
      hasPrev={false}
      hasNext={false}
      open
      onOpenChange={noop}
      onSaved={noop}
      {...overrides}
    />,
  )

describe('<PhoneBankingEntryPanel>', () => {
  it("interpolates [voter name] with the active contact's first name, set apart from the fixed script", async () => {
    renderPanel()

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText('[voter name]')).not.toBeInTheDocument()
    const nameNode = within(dialog).getByText('Alex')
    expect(nameNode).toHaveClass('font-semibold')
    // The rest of the script, including the untouched volunteer token,
    // still renders around the interpolated name.
    expect(
      within(dialog).getByText(/My name is \[your name\], a volunteer\./),
    ).toBeInTheDocument()
  })

  it('updates the interpolated name when switching the household tab', async () => {
    const user = userEvent.setup()
    const entry = buildEntry({
      persons: [
        {
          personId: 'house-a',
          name: 'Casey Household',
          firstName: 'Casey',
          age: 55,
          party: 'I',
          address: '2 Oak Ave',
          cellPhone: '5552220002',
          landline: null,
          interaction: null,
        },
        {
          personId: 'house-b',
          name: 'Robin Household',
          firstName: 'Robin',
          age: 52,
          party: 'I',
          address: '2 Oak Ave',
          cellPhone: null,
          landline: '5552220003',
          interaction: null,
        },
      ],
    })

    // PhoneBankingEntryPanel is controlled: activePersonId is a prop, so the
    // parent (PhoneBankingCallerPage in production) owns the switch. Mirror
    // that with a tiny stateful wrapper rather than the no-op used above.
    const ControlledPanel = () => {
      const [activePersonId, setActivePersonId] = useState('house-a')
      return (
        <PhoneBankingEntryPanel
          listId={42}
          script={SCRIPT_WITH_TOKEN}
          entry={entry}
          entryIndex={1}
          activePersonId={activePersonId}
          onActivePersonChange={setActivePersonId}
          onPrev={noop}
          onNext={noop}
          hasPrev={false}
          hasNext={false}
          open
          onOpenChange={noop}
          onSaved={noop}
        />
      )
    }
    render(<ControlledPanel />)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Casey')).toHaveClass('font-semibold')

    await user.click(
      within(dialog).getByRole('tab', { name: /Robin Household/ }),
    )

    expect(within(dialog).getByText('Robin')).toHaveClass('font-semibold')
    expect(within(dialog).queryByText('Casey')).not.toBeInTheDocument()
  })

  it('falls back to the first word of `name` when `firstName` is null (a list frozen before ENG-10938)', async () => {
    const entry = buildEntry({
      persons: [
        {
          personId: 'person-1',
          name: 'Jamie Multiword',
          firstName: null,
          age: null,
          party: null,
          address: null,
          cellPhone: '5551110001',
          landline: null,
          interaction: null,
        },
      ],
    })

    renderPanel({ entry })

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Jamie')).toHaveClass('font-semibold')
  })

  it('leaves an unrecognized bracket token untouched', async () => {
    renderPanel({ script: 'Hi, remember to mention [event name] today.' })

    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText('Hi, remember to mention [event name] today.'),
    ).toBeInTheDocument()
  })
})
