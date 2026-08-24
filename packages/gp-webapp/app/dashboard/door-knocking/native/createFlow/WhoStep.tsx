import {
  RadioCardItem,
  RadioGroup,
  ToggleGroup,
  ToggleGroupItem,
} from '@styleguide'
import filterSections from 'app/dashboard/contacts/[[...attr]]/components/configs/filters.config'
import { PILL_TOGGLE_ITEM_CLASSNAME } from 'app/dashboard/contacts/crm/shared/constants'
import type { VoterFileFilters } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import type { SavedListOption } from './savedListOptions'

// Contacts made is how a candidate says "only doors I haven't been to yet",
// which is the whole point of a second walk. Win-only, exactly as the CRM
// wizard treats it: campaign activity has no Serve equivalent, and gp-api
// rejects the selection outright for an elected-office org, so offering it
// there only ever surfaces as a failed knock.
const CONTACTS_MADE_FIELD_KEY = 'contacts_made'

export const ALL_CONTACTS_VALUE = 'all-contacts'

interface WhoStepProps {
  filters: VoterFileFilters
  onFiltersChange: (filters: VoterFileFilters) => void
  savedLists: SavedListOption[]
  allContactsHouseholds: number | null
  // Null is "the whole contact universe" — the state that makes a filtered
  // draft worth offering to save as a reusable list (the conditional name
  // step). Picking a list is the alternative to that offer, not a filter.
  selectedListId: number | null
  onSelectList: (listId: number | null) => void
  isElectedOfficial: boolean
}

// The count the canvas puts beside every list. Parenthesised rather than
// spelled out because it sits inside the row's accessible name, and the unit
// is carried once by the group's own label above it.
const withCount = (name: string, households: number | null) =>
  households === null ? name : `${name} (${households.toLocaleString()})`

// Step 2. Door knocking keeps its OWN filter UI — every group visible by
// scrolling, decided explicitly on the 2026-08-20 call — rather than the SMS
// and phone-banking recommended-list picker, whose popover and filter-builder
// sub-steps hide most of the dimensions behind two taps. A candidate cutting
// walking turf is choosing among sixteen dimensions at once, and the map
// underneath recolors live as the pills toggle, so hiding them costs the
// feedback the step exists for.
export const WhoStep = ({
  filters,
  onFiltersChange,
  savedLists,
  allContactsHouseholds,
  selectedListId,
  onSelectList,
  isElectedOfficial,
}: WhoStepProps) => {
  const toggleGroupValues = (
    options: Array<{ key: string; label: string }>,
  ): string[] =>
    options.filter((option) => filters[option.key]).map((option) => option.key)

  const setGroupValues = (
    options: Array<{ key: string; label: string }>,
    values: string[],
  ) => {
    const selected = new Set(values)
    const next = { ...filters }
    options.forEach((option) => {
      next[option.key] = selected.has(option.key)
    })
    onFiltersChange(next)
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
          Start from
        </span>
        <RadioGroup
          aria-label="Start from"
          value={
            selectedListId === null
              ? ALL_CONTACTS_VALUE
              : String(selectedListId)
          }
          onValueChange={(value) =>
            onSelectList(value === ALL_CONTACTS_VALUE ? null : Number(value))
          }
        >
          <RadioCardItem
            value={ALL_CONTACTS_VALUE}
            id="create-list-audience-all"
            title={withCount('All contacts', allContactsHouseholds)}
            description="Everyone in your district, narrowed by the filters below."
          />
          {savedLists.map((list) => (
            <RadioCardItem
              key={list.id}
              value={String(list.id)}
              id={`create-list-audience-${list.id}`}
              title={withCount(list.name, list.households)}
              description="A voter list you already saved."
            />
          ))}
        </RadioGroup>
      </div>

      {/* Every group, in the config's own order, with no "Add condition"
          button in front of them: the pills ARE the conditions, and a button
          that reveals what is already on screen only adds a tap. */}
      {filterSections.map((section) =>
        section.fields
          .filter(
            (field) =>
              !isElectedOfficial || field.key !== CONTACTS_MADE_FIELD_KEY,
          )
          .map((field) => (
            <div key={field.key} className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                {field.label}
              </span>
              <ToggleGroup
                type="multiple"
                value={toggleGroupValues(field.options)}
                onValueChange={(values) =>
                  setGroupValues(field.options, values)
                }
                aria-label={field.label}
                className="flex flex-wrap justify-start gap-2"
              >
                {field.options.map((option) => (
                  <ToggleGroupItem
                    key={option.key}
                    value={option.key}
                    className={PILL_TOGGLE_ITEM_CLASSNAME}
                  >
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )),
      )}
    </>
  )
}
