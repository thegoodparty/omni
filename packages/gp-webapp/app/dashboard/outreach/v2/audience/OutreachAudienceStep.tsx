'use client'

import { useState } from 'react'
import { Card, cn, Popover, PopoverContent, PopoverTrigger } from '@styleguide'
import {
  CheckIcon,
  ChevronDownIcon,
  FilterIcon,
  Loader2Icon,
  PlusIcon,
} from '@styleguide/components/ui/icons'
import type { OutreachType } from 'gpApi/types/outreach.types'
import type {
  SegmentResponse,
  SupportStatusRollup,
} from 'app/dashboard/contacts/crm/shared/contacts-types'
import type { VoterFileFilters } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import VoterFileStep from 'app/dashboard/contacts/crm/wizard/VoterFileStep'
import NameStep from 'app/dashboard/contacts/crm/wizard/NameStep'
import { Intro } from '../social/Intro'

export type OutreachAudienceMode = 'picker' | 'filters' | 'name'

// Per-feature copy. The step is channel-agnostic; each flow passes the wording
// its channel needs (e.g. SMS "Message"/"mobile number" vs robocall
// "Call"/"landline") so the same component serves every outreach feature.
export interface OutreachAudienceCopy {
  pickerTitle: string
  // The subtitle under the picker title, e.g. "We recommend reaching all your
  // supporters to increase awareness."
  pickerBody: string
  filtersTitle: string
  filtersBody: string
  nameTitle: string
  nameBody: string
  // Verb + noun for the reachable-count line, so the channel controls the whole
  // phrasing: `${reachVerb} 1,204 ${reachNoun} for $X` — robocall
  // "Reach"/"supporters with landlines", SMS "Message"/"supporters".
  reachVerb: string
  reachNoun: string
  // Unit-cost line, e.g. "Each call costs".
  unitCostLabel: string
}

interface OutreachAudienceStepProps {
  channel: OutreachType
  copy: OutreachAudienceCopy
  mode: OutreachAudienceMode
  lists: SegmentResponse[]
  listsLoading: boolean
  selectedId: number | null
  onSelect: (id: number) => void
  onStartBuilder: () => void
  // The saved list's reachable count for THIS channel (reachability[key] from
  // the list detail): null while loading or when the aggregate failed
  // server-side, in which case we show "couldn't count" rather than zero.
  reachableCount: number | null
  reachableLoading: boolean
  // 0 for a free channel (phone banking) — the cost line and the per-contact
  // rate are omitted entirely rather than rendering "for $0.00".
  pricePerContact: number
  // In-flow list builder (the CRM wizard's dumb steps re-hosted here).
  builderFilters: VoterFileFilters
  onBuilderFiltersChange: (filters: VoterFileFilters) => void
  builderSupportStatus: SupportStatusRollup[]
  onBuilderSupportStatusChange: (value: SupportStatusRollup[]) => void
  builderName: string
  onBuilderNameChange: (name: string) => void
  // Gates party/voter-likely pills in the builder (VoterFileStep) for elected
  // officials; resolved by the feature via useOutreachAudience.
  isElectedOfficial: boolean
  builderCount: number | undefined
  builderCounting: boolean
  builderCapError: boolean
  builderCountErrorMessage: string | undefined
}

const money = (n: number): string =>
  n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

export const OutreachAudienceStep = ({
  channel,
  copy,
  mode,
  lists,
  listsLoading,
  selectedId,
  onSelect,
  onStartBuilder,
  reachableCount,
  reachableLoading,
  pricePerContact,
  builderFilters,
  onBuilderFiltersChange,
  builderSupportStatus,
  onBuilderSupportStatusChange,
  builderName,
  onBuilderNameChange,
  isElectedOfficial,
  builderCount,
  builderCounting,
  builderCapError,
  builderCountErrorMessage,
}: OutreachAudienceStepProps) => {
  const [open, setOpen] = useState(false)
  const active = lists.find((l) => l.id === selectedId) ?? null

  if (mode === 'name') {
    return (
      <div className="space-y-6">
        <Intro channel={channel} title={copy.nameTitle} body={copy.nameBody} />
        <NameStep
          name={builderName}
          onNameChange={onBuilderNameChange}
          count={builderCount}
          isCounting={builderCounting}
          isCapError={builderCapError}
          countErrorMessage={builderCountErrorMessage}
          peopleNoun="voters"
        />
      </div>
    )
  }

  if (mode === 'filters') {
    return (
      <div className="space-y-6">
        <Intro
          channel={channel}
          title={copy.filtersTitle}
          body={copy.filtersBody}
        />
        <VoterFileStep
          filters={builderFilters}
          onFiltersChange={onBuilderFiltersChange}
          supportStatus={builderSupportStatus}
          onSupportStatusChange={onBuilderSupportStatusChange}
          isElectedOfficial={isElectedOfficial}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Intro
        channel={channel}
        title={copy.pickerTitle}
        body={copy.pickerBody}
      />

      <div className="space-y-2">
        <p className="text-xs font-bold uppercase text-primary">All lists</p>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Card
              role="button"
              tabIndex={0}
              className="cursor-pointer flex-row items-center justify-between gap-3 p-4 transition-colors hover:border-primary/50"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {listsLoading
                    ? 'Loading your lists…'
                    : (active?.name ?? 'Choose a voter list')}
                </p>
                {active && (
                  <p className="text-sm text-muted-foreground">
                    {reachableLoading ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2Icon className="size-3.5 animate-spin" />
                        Counting reachable voters…
                      </span>
                    ) : reachableCount !== null ? (
                      <>
                        {copy.reachVerb} {reachableCount.toLocaleString()}{' '}
                        {copy.reachNoun}
                        {pricePerContact > 0 &&
                          ` for $${money(reachableCount * pricePerContact)}`}
                      </>
                    ) : (
                      "We couldn't count this list right now."
                    )}
                  </p>
                )}
              </div>
              <ChevronDownIcon
                className={cn(
                  'size-5 shrink-0 text-muted-foreground transition-transform',
                  open && 'rotate-180',
                )}
              />
            </Card>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={4}
            className="max-h-80 w-[var(--radix-popover-trigger-width)] overflow-y-auto p-0"
          >
            <div className="divide-y divide-border">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onStartBuilder()
                }}
                className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-light">
                  <PlusIcon className="size-4 text-primary" />
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-primary">
                    Create a new list
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    Build a custom audience
                  </span>
                </span>
              </button>
              {lists.length === 0 && !listsLoading && (
                <p className="p-4 text-sm text-muted-foreground">
                  No saved lists yet.
                </p>
              )}
              {lists.map((list) => {
                const on = list.id === selectedId
                return (
                  <button
                    key={list.id}
                    type="button"
                    onClick={() => {
                      onSelect(list.id)
                      setOpen(false)
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-muted',
                      on && 'bg-muted',
                    )}
                  >
                    <span className="block min-w-0 truncate font-medium text-foreground">
                      {list.name ?? `List ${list.id}`}
                    </span>
                    {on && (
                      <CheckIcon className="size-5 shrink-0 text-primary" />
                    )}
                  </button>
                )
              })}
            </div>
          </PopoverContent>
        </Popover>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <FilterIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            The number of reachable voters in each list may change based on the
            mode of outreach you select.
          </span>
        </p>
      </div>
      {pricePerContact > 0 && (
        <p className="text-sm text-muted-foreground">
          {copy.unitCostLabel} ${pricePerContact.toFixed(3)}
        </p>
      )}
    </div>
  )
}
