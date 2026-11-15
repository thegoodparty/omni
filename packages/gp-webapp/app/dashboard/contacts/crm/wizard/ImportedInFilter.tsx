import { useMemo, useState } from 'react'
import { Drawer as VaulDrawer } from 'vaul'
import {
  Button,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  Input,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from '@styleguide'
import {
  FILTER_GROUP_LABEL_CLASSNAME,
  PILL_TOGGLE_ITEM_CLASSNAME,
} from '../shared/constants'
import type { ImportedInOptionsResult } from './useImportedInOptions'

// PrecinctFilter's rule: eight inline pills, the rest in the View all sheet.
const INLINE_LIMIT = 8

export const UNDONE_IMPORT_LABEL = 'Undone import'

interface ImportedInFilterProps {
  importedIn: ImportedInOptionsResult
  selected: string[]
  onChange: (next: string[]) => void
}

// The org's imports as pills, by the name the user gave each. Several picked
// means people in any of them.
const ImportedInFilter = ({
  importedIn,
  selected,
  onChange,
}: ImportedInFilterProps) => {
  const { options, isLoading, isError, refetch } = importedIn
  const [sheetOpen, setSheetOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selectedSet = useMemo(() => new Set(selected), [selected])

  // A saved list keeps the id of an import that was undone. It has no
  // option any more, so it stays a pill of its own until it is removed.
  const undone = useMemo(
    () => selected.filter((id) => !options.some((option) => option.id === id)),
    [selected, options],
  )

  // Same order rule as PrecinctFilter: the first eight, plus any selection
  // made in the sheet, never reordered under the cursor.
  const inline = useMemo(() => {
    const base = options.slice(0, INLINE_LIMIT)
    const baseIds = new Set(base.map((option) => option.id))
    const promoted = options.filter(
      (option) => selectedSet.has(option.id) && !baseIds.has(option.id),
    )
    return promoted.length > 0
      ? [...promoted, ...base].slice(0, INLINE_LIMIT)
      : base
  }, [options, selectedSet])

  const hiddenCount = options.length - inline.length

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return options
    return options.filter((option) => option.name.toLowerCase().includes(term))
  }, [options, query])

  const allSelected =
    options.length > 0 && options.every((option) => selectedSet.has(option.id))

  if (isLoading) {
    return (
      <div className="space-y-2">
        <span className={FILTER_GROUP_LABEL_CLASSNAME}>Imported in</span>
        <div className="flex flex-wrap gap-2">
          {[168, 184, 152].map((width, index) => (
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

  if (isError) {
    return (
      <div className="space-y-2">
        <span className={FILTER_GROUP_LABEL_CLASSNAME}>Imported in</span>
        <div className="flex items-center gap-3 rounded-md border p-3">
          <p className="flex-1 text-sm text-muted-foreground">
            We couldn’t load your imports. Every other filter still applies.
          </p>
          <Button size="small" variant="outline" onClick={refetch}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h4 className={FILTER_GROUP_LABEL_CLASSNAME}>Imported in</h4>
        {options.length > 1 && (
          <Button
            type="button"
            variant="link"
            size="small"
            className="h-auto border-none p-0 text-xs"
            onClick={() =>
              onChange(
                allSelected
                  ? []
                  : [...undone, ...options.map((option) => option.id)],
              )
            }
          >
            {allSelected ? 'Clear' : 'Select all'}
          </Button>
        )}
      </div>

      <ToggleGroup
        type="multiple"
        value={selected}
        onValueChange={onChange}
        aria-label="Imported in"
        className="flex-wrap justify-start gap-2"
      >
        {undone.map((id) => (
          <ToggleGroupItem
            key={id}
            value={id}
            className={PILL_TOGGLE_ITEM_CLASSNAME}
          >
            {UNDONE_IMPORT_LABEL}
          </ToggleGroupItem>
        ))}
        {inline.map((option) => (
          <ToggleGroupItem
            key={option.id}
            value={option.id}
            className={PILL_TOGGLE_ITEM_CLASSNAME}
          >
            {option.name}
          </ToggleGroupItem>
        ))}
        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className={PILL_TOGGLE_ITEM_CLASSNAME}
          >
            View all {options.length.toLocaleString('en-US')}
          </button>
        ) : null}
      </ToggleGroup>

      <VaulDrawer.NestedRoot open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerContent>
          <DrawerHandle />
          <DrawerHeader>
            <DrawerTitle>Imported in</DrawerTitle>
            {selected.length > 0 ? (
              <DrawerDescription>{selected.length} selected</DrawerDescription>
            ) : null}
          </DrawerHeader>
          <DrawerBody className="space-y-3 pb-8">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${options.length.toLocaleString('en-US')} imports`}
            />
            {filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No imports match “{query}”.
              </p>
            ) : (
              <ToggleGroup
                type="multiple"
                value={selected}
                onValueChange={onChange}
                aria-label="All imports"
                className="flex-wrap justify-start gap-2"
              >
                {filtered.map((option) => (
                  <ToggleGroupItem
                    key={option.id}
                    value={option.id}
                    className={PILL_TOGGLE_ITEM_CLASSNAME}
                  >
                    {option.name}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          </DrawerBody>
          <DrawerFooter>
            <Button
              type="button"
              size="large"
              className="w-full"
              onClick={() => setSheetOpen(false)}
            >
              Save
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </VaulDrawer.NestedRoot>
    </div>
  )
}

export default ImportedInFilter
