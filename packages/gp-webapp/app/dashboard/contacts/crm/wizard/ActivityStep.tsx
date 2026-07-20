'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Button,
  PlusIcon,
  ToggleGroup,
  ToggleGroupItem,
  Trash2Icon,
} from '@styleguide'
import { useOrganization } from '@shared/organization-picker'
import { clientRequest } from 'gpApi/typed-request'
import type { ActivityConditionAction } from '@goodparty_org/contracts'
import { useContactsTable } from '../ContactsTableProvider'
import {
  FILTER_GROUP_LABEL_CLASSNAME,
  PILL_TOGGLE_ITEM_CLASSNAME,
} from '../shared/constants'
import {
  ACTIVITY_CONDITION_CHANNEL_ACTIONS,
  ACTIVITY_CONDITION_ACTION_LABELS,
  ACTIVITY_CONDITION_CHANNELS,
  CHANNELS_WITHOUT_CAMPAIGN_PICKER,
  type ActivityConditionChannel,
  type ActivityConditionInput,
} from '../shared/activityConditionOptions'

export interface WizardActivityCondition {
  key: string
  outreachType: ActivityConditionChannel | ''
  outreachId: number | null
  // Display name of the selected outreach, resolved at selection time from
  // the same completed-outreaches list the picker renders from. Not sent to
  // the backend (toActivityConditionPayload below excludes it) — it exists
  // only so the wizard's onSuccess handler can build the ENG-10709
  // `sourceCampaign` analytics property without a second outreaches fetch.
  outreachName: string | null
  actions: ActivityConditionAction[]
}

let conditionKeySeq = 0
export const blankActivityCondition = (): WizardActivityCondition => ({
  key: `condition-${conditionKeySeq++}`,
  outreachType: '',
  outreachId: null,
  outreachName: null,
  actions: [],
})

export const toActivityConditionPayload = (
  conditions: WizardActivityCondition[],
): ActivityConditionInput[] =>
  conditions
    .filter((condition) => condition.outreachType !== '')
    .map((condition) => ({
      outreachType: condition.outreachType as ActivityConditionChannel,
      outreachId: condition.outreachId,
      actions: condition.actions,
    }))

// Single source for the "no display name on the record" fallback — used both
// by the campaign SelectItem's render and by handleCampaignChange's
// ENG-10709 outreachName resolution, so the two can't drift on the fallback
// chain.
export const outreachDisplayName = (outreach: {
  id: number
  name?: string | null
  title?: string | null
}): string => outreach.name || outreach.title || `Outreach #${outreach.id}`

export const isActivityStepValid = (
  conditions: WizardActivityCondition[],
): boolean =>
  conditions.length > 0 &&
  conditions.every((condition) => condition.outreachType !== '')

const ANY_CAMPAIGN_VALUE = 'any'

interface ActivityStepProps {
  conditions: WizardActivityCondition[]
  onChange: (conditions: WizardActivityCondition[]) => void
}

// Step 2 of the activity branch (Lovable-locked in ENG-10725): stacked
// inline condition groups — a "Previous activity" channel chip row, a
// "Campaign" chip row that appears once a channel is chosen, and an
// outcome ("Activity") chip row hidden behind a "Filter on activity"
// progressive reveal. Each condition keeps the same
// channel + (any | specific completed outreach) + optional outcomes model
// from ENG-10708; only the chrome changed.
export default function ActivityStep({
  conditions,
  onChange,
}: ActivityStepProps) {
  const orgSlug = useOrganization()?.slug
  const { isWinContext } = useContactsTable()
  // Progressive reveal (Lovable F4): outcome chips stay hidden per condition
  // until "Filter on activity" is clicked; the trash next to the revealed
  // row clears the clause and re-hides it. Keyed by condition key so the
  // reveal survives edits to other conditions.
  const [revealedOutcomeKeys, setRevealedOutcomeKeys] = useState<Set<string>>(
    () => new Set(),
  )

  // GET /outreach is @ReqCampaign-scoped (outreach.controller.ts:126-132) —
  // Serve orgs have no campaign, so skip the fetch entirely rather than
  // let it 4xx, and render the picker with no campaigns (Serve is "built as
  // if it has outreach").
  const outreachesQuery = useQuery({
    queryKey: ['list-wizard-outreaches', orgSlug],
    queryFn: () =>
      clientRequest('GET /v1/outreach', {}).then((res) => res.data),
    enabled: isWinContext,
  })
  const outreaches = useMemo(
    () => outreachesQuery.data ?? [],
    [outreachesQuery.data],
  )

  const completedOutreachesForChannel = (channel: ActivityConditionChannel) =>
    outreaches.filter(
      (outreach) =>
        outreach.status === 'completed' && outreach.outreachType === channel,
    )

  const updateCondition = (
    key: string,
    patch: Partial<WizardActivityCondition>,
  ) => {
    onChange(
      conditions.map((condition) =>
        condition.key === key ? { ...condition, ...patch } : condition,
      ),
    )
  }

  const handleChannelChange = (key: string, value: string) => {
    // Switching channel invalidates the previous channel's campaign + outcome
    // selections (a text outreachId or door-knock outcome is meaningless
    // once the row becomes robocall, etc).
    updateCondition(key, {
      outreachType: value as ActivityConditionChannel,
      outreachId: null,
      outreachName: null,
      actions: [],
    })
  }

  const handleCampaignChange = (
    key: string,
    value: string,
    channel: ActivityConditionChannel,
  ) => {
    if (value === ANY_CAMPAIGN_VALUE) {
      updateCondition(key, { outreachId: null, outreachName: null })
      return
    }
    const outreachId = Number(value)
    const outreach = completedOutreachesForChannel(channel).find(
      (candidate) => candidate.id === outreachId,
    )
    updateCondition(key, {
      outreachId,
      outreachName: outreachDisplayName(outreach ?? { id: outreachId }),
    })
  }

  const handleActionsChange = (key: string, values: string[]) => {
    updateCondition(key, { actions: values as ActivityConditionAction[] })
  }

  const handleRevealOutcomes = (key: string) => {
    setRevealedOutcomeKeys((keys) => new Set(keys).add(key))
  }

  const handleClearOutcomes = (key: string) => {
    setRevealedOutcomeKeys((keys) => {
      const next = new Set(keys)
      next.delete(key)
      return next
    })
    updateCondition(key, { actions: [] })
  }

  const handleRemove = (key: string) => {
    onChange(conditions.filter((condition) => condition.key !== key))
  }

  const handleAdd = () => {
    onChange([...conditions, blankActivityCondition()])
  }

  const hasAnySelection = conditions.some(
    (condition) =>
      condition.outreachType !== '' ||
      condition.outreachId !== null ||
      condition.actions.length > 0,
  )

  const handleClearFilters = () => {
    setRevealedOutcomeKeys(new Set())
    onChange([blankActivityCondition()])
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

      {conditions.map((condition, index) => {
        const channelMeta = ACTIVITY_CONDITION_CHANNELS.find(
          (channel) => channel.value === condition.outreachType,
        )
        const showCampaignPicker =
          condition.outreachType !== '' &&
          !CHANNELS_WITHOUT_CAMPAIGN_PICKER.has(condition.outreachType)
        const outcomeOptions =
          condition.outreachType !== ''
            ? ACTIVITY_CONDITION_CHANNEL_ACTIONS[condition.outreachType]
            : []
        const outcomesVisible =
          condition.outreachType !== '' &&
          (revealedOutcomeKeys.has(condition.key) ||
            condition.actions.length > 0)

        return (
          <div key={condition.key} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h4 className={FILTER_GROUP_LABEL_CLASSNAME}>
                Previous activity
              </h4>
              <div className="flex items-start justify-between gap-2">
                <ToggleGroup
                  type="single"
                  value={condition.outreachType}
                  onValueChange={(value) =>
                    value && handleChannelChange(condition.key, value)
                  }
                  aria-label="Previous activity"
                  className="flex flex-wrap gap-2"
                >
                  {ACTIVITY_CONDITION_CHANNELS.map((channel) => (
                    <ToggleGroupItem
                      key={channel.value}
                      value={channel.value}
                      className={`${PILL_TOGGLE_ITEM_CLASSNAME} gap-1.5`}
                    >
                      {channel.icon}
                      {channel.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <Button
                  variant="ghost"
                  size="small"
                  aria-label={`Remove condition ${index + 1}`}
                  disabled={conditions.length === 1}
                  onClick={() => handleRemove(condition.key)}
                  className="size-7 shrink-0 p-0"
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
            </div>

            {showCampaignPicker && channelMeta && (
              <div className="flex flex-col gap-2">
                <h4 className={FILTER_GROUP_LABEL_CLASSNAME}>Campaign</h4>
                <ToggleGroup
                  type="single"
                  value={
                    condition.outreachId != null
                      ? String(condition.outreachId)
                      : ANY_CAMPAIGN_VALUE
                  }
                  onValueChange={(value) =>
                    value &&
                    handleCampaignChange(
                      condition.key,
                      value,
                      condition.outreachType as ActivityConditionChannel,
                    )
                  }
                  aria-label="Campaign"
                  className="flex flex-wrap gap-2"
                >
                  <ToggleGroupItem
                    value={ANY_CAMPAIGN_VALUE}
                    className={PILL_TOGGLE_ITEM_CLASSNAME}
                  >
                    Any campaign
                  </ToggleGroupItem>
                  {completedOutreachesForChannel(
                    condition.outreachType as ActivityConditionChannel,
                  ).map((outreach) => (
                    <ToggleGroupItem
                      key={outreach.id}
                      value={String(outreach.id)}
                      className={PILL_TOGGLE_ITEM_CLASSNAME}
                    >
                      {outreachDisplayName(outreach)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            )}

            {condition.outreachType !== '' &&
              (outcomesVisible ? (
                <div className="flex flex-col gap-2">
                  <h4 className={FILTER_GROUP_LABEL_CLASSNAME}>Activity</h4>
                  <div className="flex items-start justify-between gap-2">
                    <ToggleGroup
                      type="multiple"
                      value={condition.actions}
                      onValueChange={(values) =>
                        handleActionsChange(condition.key, values)
                      }
                      aria-label="Activity"
                      className="flex flex-wrap gap-2"
                    >
                      {outcomeOptions.map((action) => (
                        <ToggleGroupItem
                          key={action}
                          value={action}
                          className={PILL_TOGGLE_ITEM_CLASSNAME}
                        >
                          {ACTIVITY_CONDITION_ACTION_LABELS[action]}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                    <Button
                      variant="ghost"
                      size="small"
                      aria-label="Remove activity filter"
                      onClick={() => handleClearOutcomes(condition.key)}
                      className="size-7 shrink-0 p-0"
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="small"
                  onClick={() => handleRevealOutcomes(condition.key)}
                  className="self-start"
                >
                  Filter on activity
                </Button>
              ))}
          </div>
        )
      })}

      <Button
        type="button"
        variant="outline"
        onClick={handleAdd}
        className="gap-1.5 self-center"
      >
        <PlusIcon className="size-4" />
        Add condition
      </Button>
    </div>
  )
}
