import type { CensusTractNameSource } from '../../generated/prisma'
import type { TractPlace } from '@/peopleDb/databricks/districtCensusSql.util'
import { tractNumber } from './civicPanelSteering.util'

const titleCase = (words: string): string =>
  words
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')

// "HAYWOOD" and "RD" from the voter file read "Haywood Rd". Null with no
// street name.
export const streetName = (
  place: Pick<TractPlace, 'street' | 'designator'>,
): string | null => {
  if (!place.street) return null
  return titleCase([place.street, place.designator ?? ''].join(' '))
}

type NamedTract = {
  tractGeoid: string
  name: string | null
  source: CensusTractNameSource
  street: string | null
}

const collisions = (labels: Map<string, string>): Set<string> => {
  const seen = new Map<string, number>()
  for (const label of labels.values()) {
    const key = label.toLowerCase()
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  return new Set(
    [...seen].filter(([, count]) => count > 1).map(([label]) => label),
  )
}

// Each named tract's label, distinct within the given tracts (a district's).
// Two tracts in one neighborhood add their top street ("West Asheville,
// around Haywood Rd"); any still alike add the tract number.
export const tractLabels = (rows: NamedTract[]): Map<string, string> => {
  const named = rows.filter(
    (row): row is NamedTract & { name: string } => row.name !== null,
  )
  const labels = new Map(named.map((row) => [row.tractGeoid, row.name]))
  const shared = collisions(labels)
  for (const row of named) {
    if (
      shared.has(row.name.toLowerCase()) &&
      row.source === 'neighborhood' &&
      row.street
    ) {
      labels.set(row.tractGeoid, `${row.name}, around ${row.street}`)
    }
  }
  const stillShared = collisions(labels)
  for (const [tract, label] of labels) {
    if (stillShared.has(label.toLowerCase())) {
      labels.set(tract, `${label} (Tract ${tractNumber(tract)})`)
    }
  }
  return labels
}
