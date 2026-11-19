import slugify from 'slugify'

const LOCAL_PART_BASE_MAX_LENGTH = 48

const toSlug = (value: string): string =>
  slugify(value, { lower: true, strict: true })

// "first.last" from the first and last words of the first name that
// survives transliteration; null when none do (a name in a script slugify
// can't carry over).
export const buildLocalPartBase = (...names: string[]): string | null => {
  for (const name of names) {
    const words = name
      .split(/\s+/)
      .map(toSlug)
      .filter((word) => word.length > 0)
    const first = words[0]
    const last = words[words.length - 1]
    if (!first || !last) continue
    const base = first === last ? first : `${first}.${last}`
    return base.slice(0, LOCAL_PART_BASE_MAX_LENGTH)
  }
  return null
}

export const withSuffix = (base: string, attempt: number): string =>
  attempt <= 1 ? base : `${base}${attempt}`
