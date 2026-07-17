'use client'

import { Checkbox } from '@styleguide'
import Body2 from '@shared/typography/Body2'
import filterSections from '../../[[...attr]]/components/configs/filters.config'
import { SUPPORT_STATUS_OPTIONS } from '../shared/activityConditionOptions'
import type { SupportStatusRollup } from '../shared/contacts-types'
import type { VoterFileFilters } from '../shared/voterFileFilterTransform.util'

interface VoterFileStepProps {
  filters: VoterFileFilters
  onFiltersChange: (filters: VoterFileFilters) => void
  supportStatus: SupportStatusRollup[]
  onSupportStatusChange: (value: SupportStatusRollup[]) => void
  isElectedOfficial: boolean
}

// Step 2 of the voter-file branch: the legacy FiltersSheet's filter groups,
// ported (not forked — filters.config.ts is shared data, not duplicated
// logic) plus the new Support Status section (ENG-10708).
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

  const handleCheckedChange = (checked: boolean, key: string) => {
    onFiltersChange({ ...filters, [key]: checked })
  }

  const handleSelectAll = (options: Array<{ key: string; label: string }>) => {
    const updated = { ...filters }
    options.forEach((option) => {
      updated[option.key] = true
    })
    onFiltersChange(updated)
  }

  const toggleSupportStatus = (
    value: SupportStatusRollup,
    checked: boolean,
  ) => {
    onSupportStatusChange(
      checked
        ? [...supportStatus, value]
        : supportStatus.filter((existing) => existing !== value),
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {displaySections.map((section) => (
        <div key={section.title}>
          <h3 className="text-xl lg:text-2xl font-semibold">{section.title}</h3>
          {section.fields.map((field) => (
            <div key={field.key} className="mt-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-medium text-gray-600">
                  {field.label}
                </h4>
                <div
                  className="text-xs font-semibold cursor-pointer text-blue-500"
                  onClick={() => handleSelectAll(field.options)}
                >
                  Select All
                </div>
              </div>
              {field.options.map((option) => (
                <div key={option.key} className="mt-2 flex items-center">
                  <Checkbox
                    checked={filters[option.key] ?? false}
                    onCheckedChange={(checked) =>
                      handleCheckedChange(checked === true, option.key)
                    }
                  />
                  <Body2 className="font-medium ml-2">{option.label}</Body2>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}

      <div>
        <h3 className="text-xl lg:text-2xl font-semibold">Support Status</h3>
        <div className="mt-4">
          {SUPPORT_STATUS_OPTIONS.map((option) => (
            <div key={option.value} className="mt-2 flex items-center">
              <Checkbox
                checked={supportStatus.includes(option.value)}
                onCheckedChange={(checked) =>
                  toggleSupportStatus(option.value, checked === true)
                }
              />
              <Body2 className="font-medium ml-2">{option.label}</Body2>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
