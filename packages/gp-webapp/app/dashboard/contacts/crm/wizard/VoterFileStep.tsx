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
  // same exclusion FiltersSheet applies today.
  const displaySections = isElectedOfficial
    ? filterSections.map((section) => ({
        ...section,
        fields: section.fields.filter(
          (field) => field.key !== 'political_party',
        ),
      }))
    : filterSections

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
          {section.fields.map((field) => (
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
          ))}
        </div>
      ))}

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
    </div>
  )
}
