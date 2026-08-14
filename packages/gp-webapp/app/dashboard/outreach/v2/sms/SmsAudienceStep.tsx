'use client'

import { useState } from 'react'
import { Card, cn, Popover, PopoverContent, PopoverTrigger } from '@styleguide'
import {
  CheckIcon,
  ChevronDownIcon,
  Loader2Icon,
} from '@styleguide/components/ui/icons'
import type { SegmentResponse } from 'app/dashboard/contacts/crm/shared/contacts-types'
import { Intro } from '../social/Intro'

interface SmsAudienceStepProps {
  lists: SegmentResponse[]
  listsLoading: boolean
  selectedId: number | null
  onSelect: (id: number) => void
  // The saved list's SMS-reachable count (reachability.sms from the list
  // detail): null while loading or when the aggregate failed server-side.
  reachableCount: number | null
  reachableLoading: boolean
  pricePerMessage: number
}

const money = (n: number): string =>
  n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

export const SmsAudienceStep = ({
  lists,
  listsLoading,
  selectedId,
  onSelect,
  reachableCount,
  reachableLoading,
  pricePerMessage,
}: SmsAudienceStepProps) => {
  const [open, setOpen] = useState(false)
  const active = lists.find((l) => l.id === selectedId) ?? null

  return (
    <div className="space-y-6">
      <Intro
        title="Who do you want to reach?"
        body="Pick one of your saved voter lists. We only text voters with a mobile number."
      />

      <div className="space-y-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Card
              role="button"
              tabIndex={0}
              className="cursor-pointer flex-row items-center justify-between gap-3 rounded-lg p-4"
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
                        Message {reachableCount.toLocaleString()} voters for $
                        {money(reachableCount * pricePerMessage)}
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
              {lists.length === 0 && !listsLoading && (
                <p className="p-4 text-sm text-muted-foreground">
                  No saved lists yet. Create one in Voter Data first.
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
      </div>
      <p className="text-sm text-muted-foreground">
        Each message costs ${pricePerMessage.toFixed(3)}
      </p>
    </div>
  )
}
