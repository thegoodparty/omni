import {
  DOOR_KNOCKING_LEGACY_UNIT_KEY_COLUMNS,
  DOOR_KNOCKING_UNIT_KEY_COLUMNS,
} from '@goodparty_org/contracts'

const CURRENT_SEGMENTS = DOOR_KNOCKING_UNIT_KEY_COLUMNS.length
const LEGACY_SEGMENTS = DOOR_KNOCKING_LEGACY_UNIT_KEY_COLUMNS.length

const withApartment = (line: string, apartment: string | undefined): string =>
  [line, apartment ? `Apt ${apartment}` : '']
    .filter((part) => part.length > 0)
    .join(' ')

// The unit key renders back to a human address line, apartment suffixed.
//
// Shared by the route serve and the draw-step address preview rather than
// written twice: the two surfaces name the same physical door, and a
// candidate who previews "1200 W Elm St Apt 3B" and then walks a list
// spelling it differently has been given two addresses for one house.
//
// Three key formats reach this, and they are told apart by segment count.
// A current key carries the file's whole AddressLine and needs no assembly.
// A legacy key carries parsed components and is joined back in display order —
// note that its two direction segments are always empty, because the columns
// they came from cannot hold a letter (see DOOR_KNOCKING_UNIT_KEY_COLUMNS), so
// a route frozen before the switch still prints "1234 5678" where the house is
// "1234 S 5678 W". Re-knocking that list is what fixes it; there is nothing in
// the key to recover the directions from. Anything else is a household-era key
// whose first segment is already an address line.
export const renderUnitAddress = (addressKey: string): string => {
  const parts = addressKey.split('|')

  if (parts.length === CURRENT_SEGMENTS) {
    const [line, apartment] = parts
    return withApartment(line ?? '', apartment)
  }

  if (parts.length === LEGACY_SEGMENTS) {
    const [house, prefixDir, street, designator, suffixDir, apartment] = parts
    const line = [house, prefixDir, street, designator, suffixDir]
      .filter((part) => part && part.length > 0)
      .join(' ')
    return withApartment(line, apartment)
  }

  return parts[0] ?? addressKey
}
