'use client'

import { FilterPill, FilterPillGroup } from '@goodparty_org/styleguide'
import {
  type CutFilters,
  type Party,
  type Voter,
  AGE_RANGE_OPTIONS,
  DEFAULT_FILTERS,
  EDUCATION_OPTIONS,
  ETHNICITY_OPTIONS,
  INCOME_OPTIONS,
  ISSUES,
  LANGUAGE_OPTIONS,
  MARITAL_OPTIONS,
  PARTY_OPTIONS,
  PRECINCT_OPTIONS,
  SUPPORT_OPTIONS,
  TRI_OPTIONS,
  VOTER_CATEGORY_OPTIONS,
  VOTER_STATUS_OPTIONS,
  countMatching,
} from './doorKnockingData'

type Props = {
  filters: CutFilters
  setFilters: (next: CutFilters) => void
  universe: Voter[]
}

// String-array filter keys (party is handled separately).
type ArrayKey =
  | 'issue'
  | 'registered'
  | 'voterStatus'
  | 'maritalStatus'
  | 'hasChildrenUnder18'
  | 'veteran'
  | 'homeowner'
  | 'businessOwner'
  | 'education'
  | 'incomeRange'
  | 'language'
  | 'ethnicity'
  | 'ageRange'
  | 'voterCategory'
  | 'precinct'
  | 'support'

const Section = ({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) => (
  <div className="space-y-2">
    <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
      {label}
    </p>
    {children}
  </div>
)

export const FilterFields = ({ filters, setFilters, universe }: Props) => {
  const arrayCount = (key: ArrayKey, value: string) =>
    countMatching(universe, { ...DEFAULT_FILTERS, [key]: [value] })

  const renderArray = (
    label: string,
    key: ArrayKey,
    options: { value: string; label: string }[],
  ) => {
    const value = filters[key] as string[]
    return (
      <Section label={label}>
        <FilterPillGroup
          type="multiple"
          value={value}
          onValueChange={(v) => setFilters({ ...filters, [key]: v })}
        >
          {options.map((opt) => {
            const count = arrayCount(key, opt.value)
            return (
              <FilterPill
                key={opt.value}
                value={opt.value}
                disabled={count === 0}
              >
                {opt.label} ({count})
              </FilterPill>
            )
          })}
        </FilterPillGroup>
      </Section>
    )
  }

  const partyValue = (['D', 'R', 'I', 'U'] as Party[]).filter(
    (k) => filters.party[k],
  )
  const partyCount = (k: Party) =>
    countMatching(universe, {
      ...DEFAULT_FILTERS,
      party: { D: false, R: false, I: false, U: false, [k]: true },
    })

  return (
    <div className="space-y-6">
      {renderArray('Precinct', 'precinct', [...PRECINCT_OPTIONS])}
      {renderArray('Support status', 'support', SUPPORT_OPTIONS)}

      <Section label="Political party">
        <FilterPillGroup
          type="multiple"
          value={partyValue}
          onValueChange={(v) =>
            setFilters({
              ...filters,
              party: {
                D: v.includes('D'),
                R: v.includes('R'),
                I: v.includes('I'),
                U: v.includes('U'),
              },
            })
          }
        >
          {PARTY_OPTIONS.map((opt) => {
            const count = partyCount(opt.value)
            return (
              <FilterPill
                key={opt.value}
                value={opt.value}
                disabled={count === 0}
              >
                {opt.label} ({count})
              </FilterPill>
            )
          })}
        </FilterPillGroup>
      </Section>

      {renderArray('Age range', 'ageRange', AGE_RANGE_OPTIONS)}
      {renderArray('Voter category', 'voterCategory', VOTER_CATEGORY_OPTIONS)}
      {renderArray('Registered voter', 'registered', TRI_OPTIONS)}
      {renderArray('Voter status', 'voterStatus', VOTER_STATUS_OPTIONS)}
      {renderArray('Marital status', 'maritalStatus', MARITAL_OPTIONS)}
      {renderArray('Has children under 18', 'hasChildrenUnder18', TRI_OPTIONS)}
      {renderArray('Veteran', 'veteran', TRI_OPTIONS)}
      {renderArray('Homeowner', 'homeowner', TRI_OPTIONS)}
      {renderArray('Business owner', 'businessOwner', TRI_OPTIONS)}
      {renderArray('Education', 'education', EDUCATION_OPTIONS)}
      {renderArray('Estimated income', 'incomeRange', INCOME_OPTIONS)}
      {renderArray('Language', 'language', LANGUAGE_OPTIONS)}
      {renderArray('Ethnicity group', 'ethnicity', ETHNICITY_OPTIONS)}
      {renderArray(
        'Top issue',
        'issue',
        ISSUES.map((i) => ({ value: i, label: i })),
      )}
    </div>
  )
}
