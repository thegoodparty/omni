import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import ChatListMap from './ChatListMap'

vi.mock('../../../contacts/crm/map/useListPeople', () => ({
  useListPeople: () => ({
    people: [{ id: 'p1' }],
    total: 1200,
    truncated: false,
    isLoading: false,
    isError: false,
  }),
}))
vi.mock('../../../contacts/crm/map/useSavedList', () => ({
  useSavedList: () => ({
    list: { id: 7, geoPoly: null, geoPolyLabels: null },
  }),
}))
vi.mock('../../../contacts/crm/map/ContactListMap', () => ({
  __esModule: true,
  default: () => <div data-testid="contact-map" />,
}))

describe('ChatListMap', () => {
  // The Campaign Manager renders this card too, and a candidate must never
  // read "constituents".
  it.each([
    ['win', '1,200 voters'],
    ['serve', '1,200 constituents'],
  ] as const)('counts the list in %s words', async (mode, label) => {
    render(
      <ChatListMap
        listId={7}
        name="East side"
        mode={mode}
        onRefineArea={vi.fn()}
      />,
    )

    expect(await screen.findByText(label)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Draw shapes' }),
    ).toBeInTheDocument()
  })
})
