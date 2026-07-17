'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Button,
  Label,
  PlusIcon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem,
  Trash2Icon,
} from '@styleguide'
import Body2 from '@shared/typography/Body2'
import { useOrganization } from '@shared/organization-picker'
import { clientRequest } from 'gpApi/typed-request'
import type { ActivityConditionAction } from '@goodparty_org/contracts'
import { useContactsTable } from '../ContactsTableProvider'
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
  actions: ActivityConditionAction[]
}

let conditionKeySeq = 0
export const blankActivityCondition = (): WizardActivityCondition => ({
  key: `condition-${conditionKeySeq++}`,
  outreachType: '',
  outreachId: null,
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

// Step 2 of the activity branch: stacked condition rows (ENG-10708 locked
// design). Each row is channel + (any campaign | a specific completed
// outreach of that channel) + an optional outcome multi-select.
export default function ActivityStep({
  conditions,
  onChange,
}: ActivityStepProps) {
  const orgSlug = useOrganization()?.slug
  const { isWinContext } = useContactsTable()

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
      actions: [],
    })
  }

  const handleCampaignChange = (key: string, value: string) => {
    updateCondition(key, {
      outreachId: value === ANY_CAMPAIGN_VALUE ? null : Number(value),
    })
  }

  const handleActionsChange = (key: string, values: string[]) => {
    updateCondition(key, { actions: values as ActivityConditionAction[] })
  }

  const handleRemove = (key: string) => {
    onChange(conditions.filter((condition) => condition.key !== key))
  }

  const handleAdd = () => {
    onChange([...conditions, blankActivityCondition()])
  }

  return (
    <div className="flex flex-col gap-6">
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

        return (
          <div
            key={condition.key}
            className="flex flex-col gap-3 rounded-lg border border-base-border p-4"
          >
            <div className="flex items-center justify-between">
              <Body2 className="font-semibold">Condition {index + 1}</Body2>
              {conditions.length > 1 && (
                <Button
                  variant="ghost"
                  size="small"
                  aria-label={`Remove condition ${index + 1}`}
                  onClick={() => handleRemove(condition.key)}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label>Channel</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                value={condition.outreachType}
                onValueChange={(value) =>
                  value && handleChannelChange(condition.key, value)
                }
                aria-label="Channel"
              >
                {ACTIVITY_CONDITION_CHANNELS.map((channel) => (
                  <ToggleGroupItem
                    key={channel.value}
                    value={channel.value}
                    className="gap-1.5"
                  >
                    {channel.icon}
                    {channel.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            {showCampaignPicker && channelMeta && (
              <div className="flex flex-col gap-2">
                <Label>Campaign</Label>
                <Select
                  value={
                    condition.outreachId != null
                      ? String(condition.outreachId)
                      : ANY_CAMPAIGN_VALUE
                  }
                  onValueChange={(value) =>
                    handleCampaignChange(condition.key, value)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY_CAMPAIGN_VALUE}>
                      {channelMeta.anyLabel}
                    </SelectItem>
                    {completedOutreachesForChannel(
                      condition.outreachType as ActivityConditionChannel,
                    ).map((outreach) => (
                      <SelectItem key={outreach.id} value={String(outreach.id)}>
                        {outreach.name ||
                          outreach.title ||
                          `Outreach #${outreach.id}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {condition.outreachType !== '' && (
              <div className="flex flex-col gap-2">
                <Label>Outcome (optional)</Label>
                <ToggleGroup
                  type="multiple"
                  variant="outline"
                  value={condition.actions}
                  onValueChange={(values) =>
                    handleActionsChange(condition.key, values)
                  }
                  aria-label="Outcome"
                >
                  {outcomeOptions.map((action) => (
                    <ToggleGroupItem key={action} value={action}>
                      {ACTIVITY_CONDITION_ACTION_LABELS[action]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {condition.actions.length === 0 && (
                  <Body2 className="text-xs text-muted-foreground">
                    Everyone reached through this outreach, regardless of
                    outcome.
                  </Body2>
                )}
              </div>
            )}
          </div>
        )
      })}

      <Button
        type="button"
        variant="outline"
        onClick={handleAdd}
        className="gap-1.5 self-start"
      >
        <PlusIcon className="size-4" />
        Add condition
      </Button>
    </div>
  )
}
