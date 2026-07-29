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

interface VoterFileStepProps {
  filters: VoterFileFilters
  onFiltersChange: (filters: VoterFileFilters) => void
  supportStatus: SupportStatusRollup[]
  onSupportStatusChange: (value: SupportStatusRollup[]) => void
  isElectedOfficial: boolean
}

// filters.config.ts's "Voter Demographics" section key for the Voter
// Likelihood field. Support status renders as its own hardcoded block AFTER
// every filters.config.ts section, so reordering the config's section/field
// array alone can't move Voter Likelihood "below" it (ENG-10838) — this
// wizard pulls the field out of its normal section position and renders it
// after Support status instead. The legacy flag-off page (FiltersSheet.tsx)
// is untouched, so its rendering is unaffected by this move.
const VOTER_LIKELIHOOD_FIELD_KEY = 'voter_likely'

// filters.config.ts's "General Information" section key for Contacts Made
// (ENG-10839, prototype order): pulled out the same way Voter Likelihood is,
// but rendered directly ABOVE Support status instead of below it, and
// Win-only (stripped for Serve like political_party).
const CONTACTS_MADE_FIELD_KEY = 'contacts_made'

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
  isElectedOfficial,
}: VoterFileStepProps) {
  // Political party doesn't apply to an elected official's constituent file —
  // same exclusion FiltersSheet applies today. Contacts Made is Win-only the
  // same way (campaign activity has no Serve equivalent). Voter Likelihood
  // and Contacts Made are both pulled out here (see the FIELD_KEY constants
  // above) so they can render outside their normal filters.config.ts section
  // position.
  const displaySections = filterSections.map((section) => ({
    ...section,
    fields: section.fields.filter(
      (field) =>
        field.key !== VOTER_LIKELIHOOD_FIELD_KEY &&
        field.key !== CONTACTS_MADE_FIELD_KEY &&
        (!isElectedOfficial || field.key !== 'political_party'),
    ),
  }))

  const voterLikelihoodField = filterSections
    .flatMap((section) => section.fields)
    .find((field) => field.key === VOTER_LIKELIHOOD_FIELD_KEY)

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

  const hasAnySelection = hasAnyVoterFileSelection(filters, supportStatus)

  const handleClearFilters = () => {
    onFiltersChange({})
    onSupportStatusChange([])
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

      {displaySections.map((section) => (
        <div key={section.title} className="flex flex-col gap-4">
          {section.fields.map(renderField)}
        </div>
      ))}

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

      {voterLikelihoodField && renderField(voterLikelihoodField)}
    </div>
  )
}
