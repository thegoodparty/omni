import { useState } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
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
      isServe={false}
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
          isServe={false}
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

  it('falls back to the first word of `name` when `firstName` is empty or whitespace-only', async () => {
    const entry = buildEntry({
      persons: [
        {
          personId: 'person-1',
          name: 'Jordan Multiword',
          firstName: '   ',
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
    expect(within(dialog).getByText('Jordan')).toHaveClass('font-semibold')
  })

  it('leaves an unrecognized bracket token untouched', async () => {
    renderPanel({ script: 'Hi, remember to mention [event name] today.' })

    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText('Hi, remember to mention [event name] today.'),
    ).toBeInTheDocument()
  })

  // The engaged branch is where the two surfaces diverge, and the whole point
  // of asking a constituent about follow-up rather than about support and
  // turnout. Asserted at render, not just through the draft helpers: the
  // question a volunteer reads is the deliverable, and the saved body is what
  // proves the Win vocabulary never rides along with it.
  describe('the engaged branch asks its own surface question', () => {
    const engage = async (
      user: ReturnType<typeof userEvent.setup>,
      dialog: HTMLElement,
    ) => {
      await user.click(within(dialog).getByRole('radio', { name: 'Answered' }))
      await user.click(within(dialog).getByRole('radio', { name: 'Engaged' }))
    }

    it('serve asks for follow-up, never support or turnout, and saves only that', async () => {
      const user = userEvent.setup()
      let capturedRequest: unknown
      api.mock('POST /v1/phone-banking/lists/:id/calls', ({ body }) => {
        capturedRequest = body
        return {
          status: 200,
          data: {
            entryId: 1,
            results: [
              {
                personId: 'person-1',
                interaction: {
                  outcome: 'answered',
                  supportAnswer: null,
                  willVote: null,
                  followUp: 'no',
                  occurredAt: new Date(),
                },
              },
            ],
            envelopeCompleted: false,
          },
        }
      })

      renderPanel({ isServe: true })
      const dialog = await screen.findByRole('dialog')
      await engage(user, dialog)

      expect(
        within(dialog).getByText('Do they need follow-up?'),
      ).toBeInTheDocument()
      expect(
        within(dialog).queryByText('Do they support you?'),
      ).not.toBeInTheDocument()
      expect(
        within(dialog).queryByText('Will they vote this election?'),
      ).not.toBeInTheDocument()
      // Binary, so there is no third pill to mistake for "Unsure".
      expect(
        within(dialog).queryByRole('radio', { name: 'Unsure' }),
      ).not.toBeInTheDocument()

      // One answer is terminal here, where Win needs two.
      await user.click(within(dialog).getByRole('radio', { name: 'No' }))
      await user.click(within(dialog).getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(capturedRequest).toBeDefined())
      expect(capturedRequest).toMatchObject({
        entryId: 1,
        outcome: 'answered',
        personId: 'person-1',
        followUp: 'no',
      })
      expect(capturedRequest).not.toHaveProperty('supportAnswer')
      expect(capturedRequest).not.toHaveProperty('willVote')
    })

    it('win still asks support then turnout, and never follow-up', async () => {
      const user = userEvent.setup()
      renderPanel()
      const dialog = await screen.findByRole('dialog')
      await engage(user, dialog)

      expect(
        within(dialog).getByText('Do they support you?'),
      ).toBeInTheDocument()
      expect(
        within(dialog).queryByText('Do they need follow-up?'),
      ).not.toBeInTheDocument()

      // Turnout only appears once support is answered, and Save waits for it.
      await user.click(within(dialog).getByRole('radio', { name: 'Yes' }))
      expect(
        await within(dialog).findByText('Will they vote this election?'),
      ).toBeInTheDocument()
      expect(
        within(dialog).queryByRole('button', { name: 'Save' }),
      ).not.toBeInTheDocument()
    })
  })
})
