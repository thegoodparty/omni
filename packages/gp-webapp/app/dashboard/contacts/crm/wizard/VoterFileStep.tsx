'use client'

import { Button, ToggleGroup, ToggleGroupItem } from '@styleguide'
import filterSections from '../../[[...attr]]/components/configs/filters.config'
import {
  FILTER_GROUP_LABEL_CLASSNAME,
  PILL_TOGGLE_ITEM_CLASSNAME,
} from '../shared/constants'
import { sentenceCase } from '../shared/labels.util'
import { SUPPORT_STATUS_OPTIONS } from '../shared/activityConditionOptions'
import type { SupportStatusRollup } from '../shared/contacts-types'
import {
  hasAnyVoterFileSelection,
  type VoterFileFilters,
} from '../shared/voterFileFilterTransform.util'
import PrecinctFilter from './PrecinctFilter'
import type { PrecinctOptionsResult } from './usePrecinctOptions'

interface VoterFileStepProps {
  filters: VoterFileFilters
  onFiltersChange: (filters: VoterFileFilters) => void
  supportStatus: SupportStatusRollup[]
  onSupportStatusChange: (value: SupportStatusRollup[]) => void
  precincts: string[]
  onPrecinctsChange: (value: string[]) => void
  // Fetched by the caller, not here: this component stays dumb (same reason
  // isElectedOfficial is resolved upstream), and both callers already own a
  // React Query context that a bare render of this component does not.
  precinctOptions: PrecinctOptionsResult
  isElectedOfficial: boolean
}

// filters.config.ts's "General Information" section key for Contacts Made:
// rendered directly ABOVE the hardcoded Support status block (ENG-10839,
// prototype order), and Win-only (stripped for Serve like political_party).
const CONTACTS_MADE_FIELD_KEY = 'contacts_made'

// The wizard renders every other filters.config.ts field BELOW Support
// status, in the Lovable prototype's order (ENG-10847; supersedes the
// ENG-10838 single-field pull-out). Support status is a hardcoded block with
// no config entry, so no filters.config.ts reorder could express this — and
// the config's section order must stay untouched anyway because the legacy
// flag-off page (FiltersSheet.tsx) renders it directly. Fields the prototype
// doesn't have (gender, cell phone, landline) trail at the end; a config
// field missing from this array still renders, after the ordered set.
const FIELD_ORDER_BELOW_SUPPORT_STATUS = [
  'voter_likely',
  'political_party',
  'age',
  'marital_status',
  'children',
  'veteran_status',
  'homeowner',
  'business_owner',
  'education',
  'income_ranges',
  'language',
  'ethnicity',
  'gender',
  'cell_phone',
  'landline',
]

// Step 2 of the voter-file branch (ENG-10721 locked-prototype parity): pill
// toggles over the same filters.config.ts sections/options FiltersSheet and
// the original checkbox rendering used — the filter dimensions and the
// backend payload shape (voterFileFilterTransform.util.ts) are unchanged,
// only the control chrome is new.
export default function VoterFileStep({
  filters,
  onFiltersChange,
  supportStatus,
  onSupportStatusChange,
  precincts,
  onPrecinctsChange,
  precinctOptions,
  isElectedOfficial,
}: VoterFileStepProps) {
  // Political party doesn't apply to an elected official's constituent file —
  // same exclusion FiltersSheet applies today. Contacts Made is Win-only the
  // same way (campaign activity has no Serve equivalent), and so is Voter
  // Likelihood: an elected official serves everyone in the district, so
  // segmenting constituents by how reliably they vote has no Serve meaning.
  const orderIndex = (key: string) => {
    const index = FIELD_ORDER_BELOW_SUPPORT_STATUS.indexOf(key)
    return index === -1 ? FIELD_ORDER_BELOW_SUPPORT_STATUS.length : index
  }

  const fieldsBelowSupportStatus = filterSections
    .flatMap((section) => section.fields)
    .filter(
      (field) =>
        field.key !== CONTACTS_MADE_FIELD_KEY &&
        (!isElectedOfficial ||
          (field.key !== 'political_party' && field.key !== 'voter_likely')),
    )
    .sort((a, b) => orderIndex(a.key) - orderIndex(b.key))

  const contactsMadeField = filterSections
    .flatMap((section) => section.fields)
    .find((field) => field.key === CONTACTS_MADE_FIELD_KEY)

  const selectedOptionsForField = (
    options: Array<{ key: string; label: string }>,
  ): string[] =>
    options.filter((option) => filters[option.key]).map((option) => option.key)

  const handleFieldValueChange = (
    options: Array<{ key: string; label: string }>,
    values: string[],
  ) => {
    const selected = new Set(values)
    const updated = { ...filters }
    options.forEach((option) => {
      updated[option.key] = selected.has(option.key)
    })
    onFiltersChange(updated)
  }

  const hasAnySelection = hasAnyVoterFileSelection(
    filters,
    supportStatus,
    precincts,
  )

  const handleClearFilters = () => {
    onFiltersChange({})
    onSupportStatusChange([])
    onPrecinctsChange([])
  }

  const renderField = (field: {
    key: string
    label: string
    options: Array<{ key: string; label: string }>
  }) => (
    <div key={field.key} className="flex flex-col gap-2">
      <h4 className={FILTER_GROUP_LABEL_CLASSNAME}>
        {sentenceCase(field.label)}
      </h4>
      <ToggleGroup
        type="multiple"
        value={selectedOptionsForField(field.options)}
        onValueChange={(values) =>
          handleFieldValueChange(field.options, values)
        }
        aria-label={field.label}
        className="flex flex-wrap gap-2"
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
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Filters</h3>
        {hasAnySelection && (
          <Button
            type="button"
            variant="link"
            size="small"
            className="h-auto border-none p-0 text-xs"
            onClick={handleClearFilters}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* First group on the step, per the locked prototype: Precinct sits
          above Prior contacts made. */}
      {!isElectedOfficial && (
        <PrecinctFilter
          options={precinctOptions.options}
          selected={precincts}
          onChange={onPrecinctsChange}
          isLoading={precinctOptions.isLoading}
          isError={precinctOptions.isError}
          onRetry={precinctOptions.refetch}
        />
      )}

      {!isElectedOfficial &&
        contactsMadeField &&
        renderField(contactsMadeField)}

      <div className="flex flex-col gap-2">
        <h4 className={FILTER_GROUP_LABEL_CLASSNAME}>Support status</h4>
        <ToggleGroup
          type="multiple"
          value={supportStatus}
          onValueChange={(values) =>
            onSupportStatusChange(values as SupportStatusRollup[])
          }
          aria-label="Support Status"
          className="flex flex-wrap gap-2"
        >
          {SUPPORT_STATUS_OPTIONS.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              className={PILL_TOGGLE_ITEM_CLASSNAME}
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {fieldsBelowSupportStatus.map(renderField)}
    </div>
  )
}
