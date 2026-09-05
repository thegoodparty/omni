import { useRef } from 'react'
import {
  Button,
  Card,
  Eyebrow,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
  cn,
} from '@styleguide'
import {
  CheckIcon,
  ChevronDownIcon,
  PlusIcon,
} from '@styleguide/components/ui/icons'
import type { RecommendedList } from '@goodparty_org/contracts'
import filterSections from 'app/dashboard/contacts/[[...attr]]/components/configs/filters.config'
import { PILL_TOGGLE_ITEM_CLASSNAME } from 'app/dashboard/contacts/crm/shared/constants'
import type { VoterFileFilters } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import { RecommendedListCard } from 'app/dashboard/outreach/v2/audience/RecommendedListCard'
import type { SavedListOption } from './savedListOptions'
import { WIN_ONLY_FILTER_FIELD_KEYS } from '../savedListFilters'

// The three groups an elected official is never offered — contacts made,
// political party, voter likelihood — matching `VoterFileStep`'s own strip.
// All three come from `WIN_ONLY_FILTER_FIELD_KEYS`, which is also what stops a
// saved list re-checking their pills behind the group that is no longer
// rendered.
//
// Party is the sharpest of the three and the reason this is not cosmetic:
// gp-api 400s a party filter for an `eo-` org, so an official who picked one
// got no address preview and then a failed create — a paid route the flow
// could not buy, with nothing on screen naming the pill responsible.

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
  // Whether the candidate has actively picked an audience yet. Distinct
  // from `selectedListId === null`, which is ambiguous ("nothing picked"
  // vs. "picked All contacts"). The parent flips this to true in its
  // `selectList` callback so the trigger commits to the pick — including
  // an explicit All-contacts pick — instead of showing the placeholder.
  hasPickedAudience: boolean
  // True when the current audience came from a recommended-list card,
  // not from the picker. The picker's own selected-state visuals are
  // suppressed then — the audience lives on the recommendation card, not
  // on any row of this popover, so highlighting a row (in particular the
  // default "All contacts" row) would mislead.
  hasActiveRecommendation: boolean
  isServeOrg: boolean
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
  hasPickedAudience,
  hasActiveRecommendation,
  isServeOrg,
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
  // Portal target for the picker's Popover content. The picker sits inside
  // OutreachSheet (vaul Drawer), and vaul installs `react-remove-scroll`
  // on <body>. A popover portalled to document.body (Radix's default)
  // lands OUTSIDE the drawer's scroll-allowed scope, so wheel/touch
  // events on the popover content are silently dropped. Portalling into
  // this ref instead — placed on the picker's own root — keeps scroll
  // working. Same pattern OutreachAudienceStep uses.
  const pickerRootRef = useRef<HTMLDivElement | null>(null)
  // The picker only commits its selected-state visuals (border, checkmark,
  // trigger text, selected-row tint) when a saved-list row was picked here
  // — never when the audience came from a recommendation card or from
  // hand-cut filters. The audience is committed either way (Continue is
  // gated on `hasPickedAudience`); this is just about what the picker
  // itself claims to hold.
  const showsPickerSelection = hasPickedAudience && !hasActiveRecommendation

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
                !isServeOrg || !WIN_ONLY_FILTER_FIELD_KEYS.includes(field.key),
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
  // `options` always includes the "All contacts" row prepended above, so the
  // fallback is a real row — the assertion tells the compiler what the
  // construction already guarantees.
  const active = options.find((option) => option.id === activeId) ?? options[0]!

  // Initial skeleton (matches OutreachAudienceStep's shape) covers both
  // sections while the recommendations query is in flight. The pack is
  // deliberately NOT in this gate — its 4.5s p50 / 34s p95 fetch only
  // affects per-list door counts, which skeleton in place inside the rows
  // (see popover render below and the trigger subtitle) rather than
  // holding the whole picker hostage.
  const initialLoading = recommendedListsEnabled && recommendationsLoading

  if (initialLoading) {
    return (
      <div
        data-testid="who-step-loading"
        aria-busy="true"
        aria-live="polite"
        className="flex flex-col gap-6"
      >
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <>
      {recommendedListsEnabled &&
        (recommendationsError || recommendations.length > 0) && (
          <div className="flex flex-col gap-2">
            <Eyebrow>Recommended for you</Eyebrow>
            {recommendationsError ? (
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

      <div ref={pickerRootRef} className="flex flex-col gap-2">
        <Eyebrow id="create-list-audience-label">All lists</Eyebrow>

        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>
            <Card
              role="combobox"
              tabIndex={0}
              aria-expanded={open}
              aria-haspopup="listbox"
              aria-labelledby="create-list-audience-label"
              className={cn(
                'cursor-pointer flex-row items-center justify-between gap-3 rounded-xl p-4 transition-colors',
                showsPickerSelection
                  ? 'border-primary'
                  : 'hover:border-primary/50',
              )}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {showsPickerSelection
                    ? active.name
                    : // Nothing picked from the picker (either genuinely
                      // nothing, or the audience came from a
                      // recommendation). When recommended cards are on
                      // screen, the picker's role shifts to "here's where
                      // your saved lists are"; otherwise the placeholder
                      // invites the choice.
                      recommendations.length > 0
                      ? 'View your lists here'
                      : 'Choose a voter list'}
                </span>
                {showsPickerSelection ? (
                  active.sub ? (
                    <span className="block text-sm text-muted-foreground">
                      {active.sub}
                    </span>
                  ) : (
                    // Pack hasn't landed — skeleton the count so the
                    // trigger still confirms which list is picked.
                    <Skeleton className="mt-1 h-4 w-16" />
                  )
                ) : null}
              </span>
              <ChevronDownIcon
                className={cn(
                  'size-5 shrink-0 text-muted-foreground transition-transform',
                  open && 'rotate-180',
                )}
              />
            </Card>
          </PopoverTrigger>
          {/* The panel is one card but not one listbox. "Create a new
              list" is an ACTION and not an audience — it opens the filter
              pills rather than choosing anything — so it sits outside the
              listbox: a listbox's children have to be options, and a
              stray button among them is skipped by some screen readers.
              That would strand the only route to the filter face for
              anyone not using the pointer. */}
          <PopoverContent
            align="start"
            sideOffset={4}
            // Portal into the picker's own root — see the ref
            // declaration above for why the default body portal breaks
            // scroll here.
            container={pickerRootRef.current}
            className="max-h-80 w-[var(--radix-popover-trigger-width)] overflow-y-auto rounded-md border border-border bg-card p-0 shadow-md"
          >
            <button
              type="button"
              onClick={() => {
                onBuildingChange(true)
                onOpenChange(false)
              }}
              className="flex w-full items-center gap-3 border-b border-border p-4 text-left transition-colors hover:bg-muted/60"
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
                // Only mark a row as selected once the candidate has
                // actually picked from the picker itself. `activeId`
                // falls through to "All contacts" whenever `savedListId`
                // is null — including when the audience came from a
                // recommendation card — so gating on
                // `showsPickerSelection` is what stops a recommendation
                // pick from lighting up an unrelated row in this popover.
                const selected = showsPickerSelection && option.id === activeId
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      // Even a click on "All contacts" (which maps to
                      // null at the parent) counts as an explicit pick —
                      // the parent's `selectList` flips
                      // `hasPickedAudience` true, which flows back and
                      // commits the trigger.
                      onSelectList(option.listId)
                      onOpenChange(false)
                    }}
                    className={cn(ROW_CLASSNAME, selected && 'bg-muted')}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {option.name}
                      </span>
                      {option.sub ? (
                        <span className="block text-sm text-muted-foreground">
                          {option.sub}
                        </span>
                      ) : (
                        // Pack hasn't landed for this row yet — skeleton
                        // the door count without hiding the option.
                        <Skeleton className="mt-1 h-4 w-16" />
                      )}
                    </span>
                    {selected && (
                      <CheckIcon className="size-5 shrink-0 text-primary" />
                    )}
                  </button>
                )
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </>
  )
}
