'use client'

import { useState } from 'react'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  LoaderCircleIcon,
} from '@styleguide'
import { useShowContactProModal } from './ContactProModal'
import { useContactsTable } from './ContactsTableProvider'
import { getContactsLabels } from '../../shared/contactsLabels'
import { formatPersonName } from './person/PersonOverlay'
import type { Person } from './shared/contacts-types'
import {
  MIN_TYPEAHEAD_QUERY_LENGTH,
  useContactTypeaheadSearch,
} from './useContactTypeaheadSearch'

const personMeta = (person: Person, isWinContext: boolean) =>
  [
    person.age !== null ? `Age ${person.age}` : null,
    // Party is Win-only copy: Serve hides it everywhere, same as
    // hidePoliticalParty in PersonOverlay.
    isWinContext ? person.politicalParty : null,
  ]
    .filter(Boolean)
    .join(' · ')

export const ContactTypeahead = () => {
  const showProUpgradeModal = useShowContactProModal()
  const { canUseProFeatures, selectPerson, isWinContext } = useContactsTable()
  const labels = getContactsLabels(isWinContext)
  const [query, setQuery] = useState('')
  // Escape or selecting a result closes the dropdown until the next keystroke.
  const [dismissed, setDismissed] = useState(false)
  const { results, isLoading, isEmpty, isError } =
    useContactTypeaheadSearch(query)

  const isDropdownOpen =
    !dismissed && query.trim().length >= MIN_TYPEAHEAD_QUERY_LENGTH

  const handleChange = (value: string) => {
    // The modal is UX only — gp-api still rejects non-pro searches — but a
    // non-pro keystroke must never set a query, or the debounced fetch fires.
    if (!canUseProFeatures) {
      showProUpgradeModal(true)
      return
    }
    setQuery(value)
    setDismissed(false)
  }

  const handleFocus = () => {
    if (!canUseProFeatures) {
      showProUpgradeModal(true)
    }
  }

  const handleSelect = (person: Person) => {
    selectPerson(person.id)
    setDismissed(true)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && isDropdownOpen) {
      e.preventDefault()
      setDismissed(true)
    }
  }

  return (
    <Command
      shouldFilter={false}
      onKeyDown={handleKeyDown}
      className="border-components-input-border focus-within:border-components-input-active focus-within:ring-components-input-focus relative h-10 w-full overflow-visible rounded-md border bg-components-input-base transition-[color,box-shadow] focus-within:ring-[3px] [&_[data-slot=command-input-wrapper]]:border-b-0"
    >
      <CommandInput
        placeholder={labels.searchPlaceholder}
        value={query}
        onValueChange={handleChange}
        onFocus={handleFocus}
      />
      {isDropdownOpen && (
        <CommandList className="border-base-border bg-base-surface absolute top-full right-0 left-0 z-50 mt-2 rounded-md border shadow-md">
          {isError ? (
            <div className="text-muted-foreground px-3 py-6 text-center text-sm">
              Something went wrong. Try again.
            </div>
          ) : isLoading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 px-3 py-6 text-sm">
              <LoaderCircleIcon className="size-4 animate-spin" />
              Searching...
            </div>
          ) : isEmpty ? (
            <CommandEmpty>{labels.searchNoResults}</CommandEmpty>
          ) : (
            results.map((person) => (
              <CommandItem
                key={person.id}
                value={person.id}
                onSelect={() => handleSelect(person)}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{formatPersonName(person)}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {[person.address.line1, person.address.city]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                </div>
                <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                  {personMeta(person, isWinContext)}
                </span>
              </CommandItem>
            ))
          )}
        </CommandList>
      )}
    </Command>
  )
}
