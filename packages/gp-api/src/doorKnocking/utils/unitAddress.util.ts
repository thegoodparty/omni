import {
  DOOR_KNOCKING_LEGACY_UNIT_KEY_COLUMNS,
  DOOR_KNOCKING_UNIT_KEY_COLUMNS,
} from '@goodparty_org/contracts'

const CURRENT_SEGMENTS = DOOR_KNOCKING_UNIT_KEY_COLUMNS.length
const LEGACY_SEGMENTS = DOOR_KNOCKING_LEGACY_UNIT_KEY_COLUMNS.length

// The words a file puts in front of a unit number. `ApartmentType` holds these
// in the mirror, but no stored key carries it — the unit key is
// ADDRESSLINE|APT|ZIP — so a frozen route can only be read back by matching
// them in the line itself.
const UNIT_DESIGNATORS = [
  'APT',
  'APARTMENT',
  'UNIT',
  'STE',
  'SUITE',
  'RM',
  'ROOM',
  'BLDG',
  'BUILDING',
  'FL',
  'FLOOR',
  'LOT',
  'TRLR',
  'SPC',
  'SPACE',
].join('|')

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// What is left of a line that was only ever its own unit: nothing, or the
// designator that introduced it. "APT 8309" strips to a bare "APT", which is
// not an address and is worse than the line it came from.
const ONLY_A_DESIGNATOR = new RegExp(`^(?:#|${UNIT_DESIGNATORS})?\\.?$`, 'i')

// Take the unit back off an address line.
//
// Needed because `Residence_Addresses_AddressLine` is the WHOLE line, unit
// included — "205 BENTON DR APT 8309" with `ApartmentNum` of "8309" — so a
// renderer that appends the apartment to it says the apartment twice. The
// other reason it cannot be avoided: there is no line-1 column to read
// instead. Composing one from the parsed components is what
// DOOR_KNOCKING_LEGACY_UNIT_KEY_COLUMNS did and it cannot carry a direction,
// because those two columns are INTEGER in the mirror and every letter in them
// casts to NULL. AddressLine is the only field that holds a complete line, so
// subtracting from it is the only way to get its first line.
//
// Anchored on the apartment the caller already knows rather than on the
// designator alone. A trailing "<designator> <token>" would also match a
// street whose name ends in one of those words, and guessing wrong here
// silently truncates a real address — so the number has to agree.
//
// Returns the line untouched when the strip would leave nothing addressable,
// which is a line that was never more than its own unit.
export const stripUnitFromLine = (line: string, apartment: string): string =>
  stripOnce(line, apartment, true) ?? stripOnce(line, apartment, false) ?? line

// One attempt, reporting null rather than the unchanged line so a caller with
// several apartments to try can tell a miss from a no-op.
//
// The designator is required or forbidden rather than optional because the two
// cases are not equally trustworthy and must not compete on position. "Apt 5"
// says a unit outright; a bare trailing "5" only might, and on a numbered road
// — "3400 County Road 12 Apt 5" — the road number is exactly such a token.
// Trying every designator-anchored match before any bare one is what stops the
// road number being eaten by a neighbour whose apartment happens to be 12.
const stripOnce = (
  line: string,
  apartment: string,
  requireDesignator: boolean,
): string | null => {
  if (!apartment) return null

  const unit = escapeRegExp(apartment)
  const stripped = line
    .replace(
      new RegExp(
        requireDesignator
          ? `\\s+(?:${UNIT_DESIGNATORS})\\s*#?\\s*${unit}\\.?$`
          : `\\s+#?\\s*${unit}\\.?$`,
        'i',
      ),
      '',
    )
    .trim()

  if (stripped === line.trim()) return null
  // What is left is not an address, so the line was never more than its own
  // unit — report a miss and let another attempt, or the original, stand.
  return ONLY_A_DESIGNATOR.test(stripped) ? null : stripped
}

// The two lines an envelope would carry: the street line, and the unit within
// it. `line2` is empty for a single-family house, which is the caller's signal
// that the door needs no naming beyond its stop — there is only one.
export type UnitAddressLines = { line1: string; line2: string }

// The unit key read back as the two lines of a human address.
//
// Shared by the route serve and the draw-step address preview rather than
// written twice: the two surfaces name the same physical door, and a candidate
// who previews "1200 W Elm St Apt 3B" and then walks a list spelling it
// differently has been given two addresses for one house.
//
// Three key formats reach this, and they are told apart by segment count.
// A current key carries the file's whole AddressLine, so its unit is
// subtracted rather than assembled. A legacy key carries parsed components and
// is joined back in display order — note that its two direction segments are
// always empty, because the columns they came from cannot hold a letter (see
// DOOR_KNOCKING_UNIT_KEY_COLUMNS), so a route frozen before the switch still
// prints "1234 5678" where the house is "1234 S 5678 W". Re-knocking that list
// is what fixes it; there is nothing in the key to recover the directions from.
// Anything else is a household-era key whose first segment is already an
// address line and which names no unit at all.
export const splitUnitAddress = (addressKey: string): UnitAddressLines => {
  const parts = addressKey.split('|')

  if (parts.length === CURRENT_SEGMENTS) {
    const [line, apartment] = parts
    return {
      line1: stripUnitFromLine(line ?? '', apartment ?? ''),
      line2: apartment ? `Apt ${apartment}` : '',
    }
  }

  if (parts.length === LEGACY_SEGMENTS) {
    const [house, prefixDir, street, designator, suffixDir, apartment] = parts
    // Composed from components that never included the apartment, so there is
    // nothing to subtract here.
    const line1 = [house, prefixDir, street, designator, suffixDir]
      .filter((part) => part && part.length > 0)
      .join(' ')
    return { line1, line2: apartment ? `Apt ${apartment}` : '' }
  }

  return { line1: parts[0] ?? addressKey, line2: '' }
}

// The bare unit number a key names, for callers that need to subtract it from
// a line they hold rather than from the key's own. The stop's frozen
// `displayAddress` is one of these lines: it has nicer casing than the
// uppercased key, so it is the one worth keeping and the apartment has to come
// from elsewhere to clean it.
export const apartmentOf = (addressKey: string): string => {
  const parts = addressKey.split('|')

  if (parts.length === CURRENT_SEGMENTS) return parts[1] ?? ''
  if (parts.length === LEGACY_SEGMENTS) return parts[5] ?? ''
  return ''
}

// The street line of a stop, from the line frozen on it and the units of every
// door beneath it.
//
// The frozen line belongs to whichever resident sorted first, so it may carry
// any one of those units — or none, if the building has an unnumbered door.
// Every apartment is offered the line and the first that matches takes its
// unit off.
//
// Matched against the stop's own doors rather than parsed out by shape because
// the alternative is guessing: "205 BENTON DR APT 8309" and a street genuinely
// named "... Apt" are the same pattern, and a wrong guess quietly deletes part
// of a real address.
//
// AT MOST ONE strip, which is the whole reason this is not a reduce. A frozen
// line carries one unit, so one removal is all that can ever be right — and
// folding the strips let the first expose a tail for the next to eat:
// "3400 County Road 12 Apt 5" lost "Apt 5" to one door and then its road
// number to a neighbour in unit 12. Prisma returns the targets unordered, so
// that also made the stop's name depend on row order, and two serves of an
// unchanged route could disagree.
export const streetLineOfStop = (
  displayAddress: string,
  addressKeys: string[],
): string => {
  const apartments = addressKeys
    .map(apartmentOf)
    .filter((apartment) => apartment.length > 0)

  // Both passes run over every door before the next begins, so a confident
  // match anywhere in the building beats a speculative one — see `stripOnce`.
  for (const requireDesignator of [true, false]) {
    for (const apartment of apartments) {
      const stripped = stripOnce(displayAddress, apartment, requireDesignator)
      if (stripped !== null) return stripped
    }
  }

  return displayAddress
}

const normalizeLine = (line: string): string =>
  line.trim().replace(/\s+/g, ' ').toUpperCase()

// Whether two street lines name the same house, ignoring the casing and
// spacing they were written with.
//
// Asked because a door's own line comes off the key, which the mirror
// uppercases, while the stop's comes off the frozen display line, which is
// cased as a person would write it. When they agree the nicer one should win —
// a door should not SHOUT under the building it belongs to. When they disagree
// the door has to keep its own: a stop is a coordinate, and two genuinely
// different street lines that geocode to the same point are one stop with two
// houses under it. Handing both the stop's line would rename one of them.
export const sameStreetLine = (a: string, b: string): boolean =>
  normalizeLine(a) === normalizeLine(b)

// The whole address of one door, for the surfaces that have no stop heading
// above them to carry the street: the draw step's door list and the printed
// walk sheet, where a row reading only "Apt 8309" names no house at all.
//
// `streetLine` is a line the caller already holds for this door's building,
// ALREADY cleaned of any unit — `streetLineOfStop` is what produces one. It is
// preferred over the key's own line for its casing, and only when the two name
// the same house; see `sameStreetLine` for why that check cannot be skipped.
//
// Taken as a parameter rather than derived here because the caller is the only
// one who knows the building: a door's own apartment is not necessarily the
// one its stop was frozen under, so cleaning the line against this key alone
// would leave a neighbour's unit on it. Defaulted to nothing for a caller with
// no better-cased line to offer, which falls back to the key's own.
export const renderDoorAddress = (
  addressKey: string,
  streetLine = '',
): string => {
  const { line1, line2 } = splitUnitAddress(addressKey)
  // The caller's line wherever the key has nothing better: either the two name
  // one house, in which case it is the same line better cased, or the key gave
  // up no street at all and the building it sits under is all there is to go
  // on.
  const street =
    line1 && !sameStreetLine(line1, streetLine) ? line1 : streetLine
  return joinUnitAddress({ line1: street, line2 })
}

// The two lines back into one, skipping an absent line rather than printing
// its gap — so a door with no unit is its street, and a key that yielded no
// street is still named by its unit.
const joinUnitAddress = ({ line1, line2 }: UnitAddressLines): string =>
  [line1, line2].filter((part) => part.length > 0).join(' ')
