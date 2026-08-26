import { useMemo, useState } from 'react'
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  Input,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from '@styleguide'
import {
  encodePrecinctPair,
  type PrecinctOption,
} from '@goodparty_org/contracts'
import {
  FILTER_GROUP_LABEL_CLASSNAME,
  PILL_TOGGLE_ITEM_CLASSNAME,
} from '../shared/constants'

// p75 of an ICP district is 13-15 precincts and the median is 5-6, so eight
// inline pills cover most districts outright and the sheet is for the tail.
const INLINE_LIMIT = 8

const UNKNOWN_LABEL = 'Unknown'

const keyOf = (option: PrecinctOption) =>
  encodePrecinctPair(option.county, option.precinct)

// L2 ships county names uppercase. Title-cased for display only; the word
// "County" is deliberately not appended, because Louisiana has parishes and
// Alaska has boroughs and the file does not record which.
const titleCase = (value: string) =>
  value.toLowerCase().replace(/\b[a-z]/g, (char) => char.toUpperCase())

const labelOf = (option: PrecinctOption) =>
  option.precinct === ''
    ? UNKNOWN_LABEL
    : `${titleCase(option.county)} — ${option.precinct}`

interface PrecinctFilterProps {
  options: PrecinctOption[]
  selected: string[]
  onChange: (next: string[]) => void
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}

export default function PrecinctFilter({
  options,
  selected,
  onChange,
  isLoading,
  isError,
  onRetry,
}: PrecinctFilterProps) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selectedSet = useMemo(() => new Set(selected), [selected])

  // County then precinct, with the Unknown bucket held out — it is placed
  // explicitly below rather than sorted, so it can never be pushed off the
  // inline row by an alphabetically-earlier precinct.
  const { named, unknown } = useMemo(() => {
    const withPrecinct = options.filter((option) => option.precinct !== '')
    const without = options.filter((option) => option.precinct === '')
    withPrecinct.sort((a, b) =>
      a.county === b.county
        ? a.precinct.localeCompare(b.precinct)
        : a.county.localeCompare(b.county),
    )
    // Several counties in one district can each hold unassigned voters (55
    // districts nationally). They collapse into one Unknown pill so the row
    // never shows the same word twice with nothing to tell the two apart.
    return {
      named: withPrecinct,
      unknown: without.length > 0 ? without : null,
    }
  }, [options])

  const unknownKeys = useMemo(() => (unknown ?? []).map(keyOf), [unknown])
  const unknownSelected =
    unknownKeys.length > 0 && unknownKeys.every((key) => selectedSet.has(key))

  // The first eight in document order, plus any selection made inside the
  // sheet that would otherwise be hidden. Deliberately not "selected first":
  // that reorders the row as it is clicked, moving the pill out from under
  // the cursor.
  const inline = useMemo(() => {
    const slots = unknown ? INLINE_LIMIT - 1 : INLINE_LIMIT
    const base = named.slice(0, slots)
    const baseKeys = new Set(base.map(keyOf))
    const promoted = named.filter(
      (option) =>
        selectedSet.has(keyOf(option)) && !baseKeys.has(keyOf(option)),
    )
    return promoted.length > 0 ? [...promoted, ...base].slice(0, slots) : base
  }, [named, selectedSet, unknown])

  const hiddenCount = named.length - inline.length

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return named
    return named.filter((option) =>
      labelOf(option).toLowerCase().includes(term),
    )
  }, [named, query])

  const toggleUnknown = () => {
    onChange(
      unknownSelected
        ? selected.filter((value) => !unknownKeys.includes(value))
        : [...selected, ...unknownKeys.filter((key) => !selectedSet.has(key))],
    )
  }

  const unknownPill = (keySuffix: string) =>
    unknown ? (
      <button
        key={`unknown-${keySuffix}`}
        type="button"
        onClick={toggleUnknown}
        data-state={unknownSelected ? 'on' : 'off'}
        className={PILL_TOGGLE_ITEM_CLASSNAME}
      >
        {UNKNOWN_LABEL}
      </button>
    ) : null

  if (isLoading) {
    return (
      <div className="space-y-2">
        <span className={FILTER_GROUP_LABEL_CLASSNAME}>Precinct</span>
        <div className="flex flex-wrap gap-2">
          {[168, 184, 152, 176].map((width, index) => (
            <Skeleton
              key={index}
              className="h-[38px] rounded-full"
              style={{ width }}
            />
          ))}
        </div>
      </div>
    )
  }

  // A precinct list that will not load must not block the wizard — every
  // other filter still applies and the list can still be saved without one.
  if (isError) {
    return (
      <div className="space-y-2">
        <span className={FILTER_GROUP_LABEL_CLASSNAME}>Precinct</span>
        <div className="flex items-center gap-3 rounded-md border p-3">
          <p className="flex-1 text-sm text-muted-foreground">
            We couldn’t load precincts. Every other filter still applies.
          </p>
          <Button size="small" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  if (options.length === 0) {
    return (
      <div className="space-y-2">
        <span className={FILTER_GROUP_LABEL_CLASSNAME}>Precinct</span>
        <p className="text-sm text-muted-foreground">No precinct data found.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <span className={FILTER_GROUP_LABEL_CLASSNAME}>Precinct</span>

      <ToggleGroup
        type="multiple"
        value={selected}
        onValueChange={onChange}
        aria-label="Precinct"
        className="flex-wrap justify-start gap-2"
      >
        {inline.map((option) => (
          <ToggleGroupItem
            key={keyOf(option)}
            value={keyOf(option)}
            className={PILL_TOGGLE_ITEM_CLASSNAME}
          >
            {labelOf(option)}
          </ToggleGroupItem>
        ))}
        {unknownPill('inline')}
        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className={PILL_TOGGLE_ITEM_CLASSNAME}
          >
            View all {named.length.toLocaleString('en-US')}
          </button>
        ) : null}
      </ToggleGroup>

      <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerContent>
          <DrawerHandle />
          <DrawerHeader>
            <DrawerTitle className="text-base">
              Precinct
              {selected.length > 0 ? (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {selected.length} selected
                </span>
              ) : null}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody className="space-y-3 pb-8">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${named.length.toLocaleString('en-US')} precincts`}
            />
            {filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No precincts match “{query}”.
              </p>
            ) : (
              <ToggleGroup
                type="multiple"
                value={selected}
                onValueChange={onChange}
                aria-label="All precincts"
                className="flex-wrap justify-start gap-2"
              >
                {filtered.map((option) => (
                  <ToggleGroupItem
                    key={keyOf(option)}
                    value={keyOf(option)}
                    className={PILL_TOGGLE_ITEM_CLASSNAME}
                  >
                    {labelOf(option)}
                  </ToggleGroupItem>
                ))}
                {query.trim() ? null : unknownPill('sheet')}
              </ToggleGroup>
            )}
          </DrawerBody>
        </DrawerContent>
      </Drawer>
    </div>
  )
}
