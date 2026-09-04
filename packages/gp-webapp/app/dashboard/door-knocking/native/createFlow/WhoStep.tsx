import { useEffect, useRef } from 'react'
import {
  Button,
  Card,
  Eyebrow,
  ToggleGroup,
  ToggleGroupItem,
  cn,
} from '@styleguide'
import {
  CheckIcon,
  ChevronDownIcon,
  Loader2Icon,
  PlusIcon,
} from '@styleguide/components/ui/icons'
import type { RecommendedList } from '@goodparty_org/contracts'
import filterSections from 'app/dashboard/contacts/[[...attr]]/components/configs/filters.config'
import { PILL_TOGGLE_ITEM_CLASSNAME } from 'app/dashboard/contacts/crm/shared/constants'
import type { VoterFileFilters } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import { RecommendedListCard } from 'app/dashboard/outreach/v2/audience/RecommendedListCard'
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
  // Null is "the whole contact universe". Picking a list is the alternative
  // to cutting one by hand, not a filter.
  selectedListId: number | null
  onSelectList: (listId: number | null) => void
  isElectedOfficial: boolean
  // Which of the step's two faces is on screen: the list picker, or the
  // filter pills behind "Create a new list". Lifted so it survives a step back
  // from the draw step, which remounts this component.
  building: boolean
  onBuildingChange: (building: boolean) => void
  // The picker is a listbox rather than a `Select` because the design's rows
  // are two lines — a name over a door count — and it opens with a "Create a
  // new list" action above the options that is not itself an option.
  open: boolean
  onOpenChange: (open: boolean) => void
  // Recommended lists (docs/features/recommended-lists.md), rendered above
  // "All lists" in the picker face only — the same placement Task 8 used for
  // the shared outreach audience step. `recommendedListsEnabled` reflects
  // the win-recommended-lists flag; false renders this step with none of
  // this, byte-identical to before the feature existed.
  recommendedListsEnabled: boolean
  recommendations: RecommendedList[]
  recommendationsLoading: boolean
  // A warehouse outage is a deliberate 502/504 from the endpoint, not an
  // empty answer, and rendering nothing for it tells a candidate they have
  // no recommendations. Same distinction OutreachAudienceStep draws.
  recommendationsError: boolean
  // A recommendation that already exists as a saved list is routed to that
  // list by the caller (reusing `onSelectList`'s own side effects) rather
  // than creating a duplicate; this fires for every card regardless.
  onSelectRecommendation: (recommendation: RecommendedList) => void
}

// The unit the rows are counted in, spelled out rather than parenthesised:
// each row is two lines, and the count line carries its own noun.
const doorCount = (households: number | null) =>
  households === null ? '' : `${households.toLocaleString()} doors`

// The design's group heading: 12px semibold uppercase in muted, with its own
// tracking. Not `FILTER_GROUP_LABEL_CLASSNAME` — that is the CRM wizard's
// sentence-case near-black label, and this step is the door-knocking design.
const GROUP_LABEL_CLASSNAME =
  'text-xs font-semibold uppercase tracking-[0.03em] text-muted-foreground'

const ROW_CLASSNAME =
  'flex w-full items-center justify-between gap-3 border-b border-border p-4 text-left last:border-b-0 hover:bg-muted/60'

// Step 2, and it has two faces.
//
// The FIRST is a list picker, and it is the one the step opens on: a single
// control naming the audience and its door count, over a panel of every list
// the org has. Door knocking is picked from a list far more often than it is
// cut from scratch, and the earlier build had that backwards — sixteen filter
// groups on arrival, with the saved lists collapsed into a one-line select
// above them.
//
// The SECOND is those filter groups, reached by "Create a new list" and
// returned from by "Back to lists". Every group is visible by scrolling
// (decided on the 2026-08-20 call) rather than hidden behind the SMS and
// phone-banking filter-builder sub-steps: a candidate cutting walking turf is
// choosing among sixteen dimensions at once.
//
// Building a new list is NOT a way out of the flow. It picks the audience and
// nothing more — the Continue button under it goes to the draw step like every
// other audience does.
export const WhoStep = ({
  filters,
  onFiltersChange,
  savedLists,
  allContactsHouseholds,
  selectedListId,
  onSelectList,
  isElectedOfficial,
  building,
  onBuildingChange,
  open,
  onOpenChange,
  recommendedListsEnabled,
  recommendations,
  recommendationsLoading,
  recommendationsError,
  onSelectRecommendation,
}: WhoStepProps) => {
  const pickerRef = useRef<HTMLDivElement>(null)

  // A panel that overlays the rest of the step has to close on the two
  // gestures every menu closes on, or it traps the step underneath it.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node))
        onOpenChange(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onOpenChange])

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

  if (building) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <Eyebrow>Filters</Eyebrow>
          <Button
            variant="ghost"
            size="small"
            className="text-primary"
            onClick={() => onBuildingChange(false)}
          >
            Back to lists
          </Button>
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
                <span className={GROUP_LABEL_CLASSNAME}>{field.label}</span>
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
      </div>
    )
  }

  const options = [
    {
      id: ALL_CONTACTS_VALUE,
      listId: null,
      name: 'All contacts',
      sub: doorCount(allContactsHouseholds),
    },
    ...savedLists.map((list) => ({
      id: String(list.id),
      listId: list.id,
      name: list.name,
      sub: doorCount(list.households),
    })),
  ]
  const activeId =
    selectedListId === null ? ALL_CONTACTS_VALUE : String(selectedListId)
  const active = options.find((option) => option.id === activeId) ?? options[0]

  return (
    <>
      {recommendedListsEnabled &&
        (recommendationsLoading ||
          recommendationsError ||
          recommendations.length > 0) && (
          <div className="flex flex-col gap-2">
            <Eyebrow>Recommended for you</Eyebrow>
            {recommendationsLoading ? (
              <div
                data-testid="recommended-lists-loading"
                className="flex items-center gap-1.5 text-sm text-muted-foreground"
              >
                <Loader2Icon className="size-3.5 animate-spin" />
                Finding your best audiences…
              </div>
            ) : recommendationsError ? (
              <p
                data-testid="recommended-lists-error"
                className="text-sm text-destructive"
              >
                We couldn&apos;t load recommendations right now.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {recommendations.map((recommendation) => (
                  <RecommendedListCard
                    key={recommendation.variant}
                    recommendation={recommendation}
                    channel="doorKnocking"
                    onSelect={() => onSelectRecommendation(recommendation)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

      <div ref={pickerRef} className="relative flex flex-col gap-2">
        <Eyebrow id="create-list-audience-label">All lists</Eyebrow>

        <Card
          role="combobox"
          tabIndex={0}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-labelledby="create-list-audience-label"
          onClick={() => onOpenChange(!open)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onOpenChange(!open)
            }
          }}
          className={cn(
            'cursor-pointer flex-row items-center justify-between gap-3 rounded-xl p-4 transition-colors',
            selectedListId !== null
              ? 'border-primary'
              : 'hover:border-primary/50',
          )}
        >
          <span className="min-w-0">
            <span className="block truncate font-medium">
              {active ? active.name : 'Select a list'}
            </span>
            <span className="block text-sm text-muted-foreground">
              {active ? active.sub : ''}
            </span>
          </span>
          <ChevronDownIcon
            className={cn(
              'size-5 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </Card>

        {open && (
          // The panel is one card but not one listbox. "Create a new list" is an
          // ACTION and not an audience — it opens the filter pills rather than
          // choosing anything — so it sits outside the listbox: a listbox's
          // children have to be options, and a stray button among them is
          // skipped by some screen readers. That would strand the only route to
          // the filter face for anyone not using the pointer.
          <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 overflow-hidden rounded-md border border-border bg-card shadow-md">
            <button
              type="button"
              onClick={() => {
                onBuildingChange(true)
                onOpenChange(false)
              }}
              className="flex w-full items-center gap-3 border-b border-border p-4 text-left hover:bg-muted/60"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <PlusIcon className="size-4 text-primary" />
              </span>
              <span>
                <span className="block font-medium text-primary">
                  Create a new list
                </span>
                <span className="block text-sm text-muted-foreground">
                  Build a custom audience
                </span>
              </span>
            </button>

            <div role="listbox" aria-labelledby="create-list-audience-label">
              {options.map((option) => {
                const selected = option.id === activeId
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onSelectList(option.listId)
                      onOpenChange(false)
                    }}
                    className={cn(
                      ROW_CLASSNAME,
                      selected && 'bg-primary/10 hover:bg-primary/10',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {option.name}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {option.sub}
                      </span>
                    </span>
                    {selected && (
                      <CheckIcon className="size-5 shrink-0 text-primary" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
