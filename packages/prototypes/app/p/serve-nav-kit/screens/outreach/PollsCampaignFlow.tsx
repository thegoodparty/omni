'use client'

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  Loader2,
  Mic,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
} from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Calendar,
  Card,
  cn,
  Drawer,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  FilterPill,
  FilterPillGroup,
  IconButton,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stepper,
  Textarea,
  toast,
} from '@goodparty_org/styleguide'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import { SectionLabel } from '../../components/SectionLabel'
import { CHANNEL_ICON, CHANNEL_ICON_TINT } from './data'
import { useSpeechDictation } from './useSpeechDictation'
import {
  OPT_OUT_FOOTER,
  SMS_CHAR_LIMIT,
  hasIntro,
  messageEndsWithOptOut,
} from './smsData'
import {
  type Audience,
  type PollTone,
  type PollTopicId,
  AUDIENCES,
  DEFAULT_AUDIENCE,
  FILTER_POOLS,
  POLL_COST_PER_RECIPIENT,
  POLL_RECOMMENDATION,
  POLL_TONES,
  POLL_TONE_ICONS,
  POLL_TOPICS,
  TIME_OPTIONS,
  detectBias,
  estimateAudienceSize,
  formatMoney,
  generatePollDraft,
  pollIntroFor,
  polishPoll,
} from './pollData'

// Review header reuses the channel card's icon + tint (single source of truth).
const PollChannelIcon = CHANNEL_ICON.polls

export type ScheduledPoll = {
  name: string
  audience: Audience
  sendAt: Date
  message: string
  cost: number
  topicId: PollTopicId
  topicLabel: string
}

type Step = 1 | 2 | 3 | 4 | 5

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
const fmtDateTime = (d: Date) =>
  `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`

// Renders {merge_var} tokens as inline pills, readable on both the light editor
// card and the dark (bg-primary) preview bubble.
const renderWithMergeVars = (text: string): ReactNode =>
  text.split(/(\{[a-zA-Z0-9_ ]+\})/g).map((part, i) => {
    if (/^\{[a-zA-Z0-9_ ]+\}$/.test(part)) {
      const label = part
        .slice(1, -1)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
      return (
        <span
          key={i}
          className="bg-primary-light text-primary-dark mx-0.5 inline-flex items-center rounded-full px-2 py-0.5 align-baseline text-xs font-medium"
        >
          {label}
        </span>
      )
    }
    return <span key={i}>{part}</span>
  })

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  onScheduled: (result: ScheduledPoll) => void
}

export const PollsCampaignFlow = ({
  open,
  onOpenChange,
  onScheduled,
}: Props) => {
  const [step, setStep] = useState<Step>(1)
  const [topicId, setTopicId] = useState<PollTopicId | null>(null)
  const [customTopic, setCustomTopic] = useState('')

  const [audiences, setAudiences] = useState<Audience[]>(AUDIENCES)
  const [selectedAudienceId, setSelectedAudienceId] = useState(
    DEFAULT_AUDIENCE.id,
  )
  const [building, setBuilding] = useState(false)
  const [naming, setNaming] = useState(false)
  const [builderName, setBuilderName] = useState('')
  const [builderFilters, setBuilderFilters] = useState<string[]>([])
  const builderCount = useMemo(
    () => estimateAudienceSize(builderFilters),
    [builderFilters],
  )

  const [date, setDate] = useState<Date | undefined>(() => {
    const d = new Date()
    d.setDate(d.getDate() + 3)
    d.setHours(10, 0, 0, 0)
    return d
  })
  const [timeSlot, setTimeSlot] = useState('10')
  const [customTime, setCustomTime] = useState('10:00')
  const [campaignName, setCampaignName] = useState('')

  const [tone, setTone] = useState<PollTone>('Neutral')
  const [loadingDraft, setLoadingDraft] = useState(false)
  const [message, setMessage] = useState('')
  const [polishing, setPolishing] = useState(false)
  const [undoText, setUndoText] = useState<string | null>(null)

  const [biasChecked, setBiasChecked] = useState(false)
  const [biasHits, setBiasHits] = useState<string[]>([])
  const [biasChecking, setBiasChecking] = useState(false)

  const [processing, setProcessing] = useState(false)
  const [success, setSuccess] = useState(false)

  const selectedAudience = useMemo(
    () =>
      audiences.find((a) => a.id === selectedAudienceId) ?? DEFAULT_AUDIENCE,
    [audiences, selectedAudienceId],
  )
  const activeTopic = useMemo(
    () => POLL_TOPICS.find((t) => t.id === topicId) ?? null,
    [topicId],
  )
  const activeTopicLabel =
    topicId === 'custom'
      ? customTopic.trim() || 'Custom topic'
      : (activeTopic?.label ?? '')

  const cost = selectedAudience.count * POLL_COST_PER_RECIPIENT
  const earliestSend = useMemo(() => Date.now() + 48 * 60 * 60 * 1000, [open])

  const scheduledAt = useMemo(() => {
    if (!date) return null
    const slot = TIME_OPTIONS.find((t) => t.id === timeSlot)
    const timeStr = timeSlot === 'custom' ? customTime : slot?.time
    if (!timeStr) return null
    const [hh, mm] = timeStr.split(':').map(Number)
    if (hh === undefined || mm === undefined) return null
    const d = new Date(date)
    d.setHours(hh, mm, 0, 0)
    return d
  }, [date, timeSlot, customTime])

  const violates48h = scheduledAt ? scheduledAt.getTime() < earliestSend : false

  const clearBias = () => {
    setBiasChecked(false)
    setBiasHits([])
  }

  const editMessage = (v: string) => {
    setMessage(v)
    setUndoText(null)
    clearBias()
  }

  const lastAutoName = useRef('')
  useEffect(() => {
    const def = `${selectedAudience.name} — Poll${date ? `, ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`
    if (campaignName === '' || campaignName === lastAutoName.current) {
      setCampaignName(def)
      lastAutoName.current = def
    }
  }, [selectedAudience, date, campaignName])

  // Draft the question when the compose step opens.
  useEffect(() => {
    if (step !== 4) return
    if (topicId === 'custom') {
      if (!message)
        setMessage(
          `${pollIntroFor()} We want to hear from you: ${customTopic.trim() || '…'}. Reply with your thoughts.`,
        )
      return
    }
    if (message.trim()) return
    setLoadingDraft(true)
    const t = setTimeout(() => {
      setMessage(generatePollDraft(topicId ?? 'affordable-housing'))
      setUndoText(null)
      clearBias()
      setLoadingDraft(false)
    }, 650)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const regenerate = () => {
    if (!topicId || topicId === 'custom') return
    setLoadingDraft(true)
    setTimeout(() => {
      setMessage(generatePollDraft(topicId))
      setUndoText(null)
      clearBias()
      setLoadingDraft(false)
    }, 650)
  }

  const handlePolish = () => {
    if (!message.trim()) return
    setUndoText(message)
    setPolishing(true)
    setTimeout(() => {
      setMessage((m) => polishPoll(m))
      clearBias()
      setPolishing(false)
    }, 700)
  }

  const handleUndo = () => {
    if (undoText === null) return
    setMessage(undoText)
    setUndoText(null)
    clearBias()
  }

  const runBiasCheck = () => {
    setBiasChecking(true)
    setTimeout(() => {
      setBiasHits(detectBias(message))
      setBiasChecked(true)
      setBiasChecking(false)
    }, 500)
  }

  const reset = () => {
    setStep(1)
    setTopicId(null)
    setCustomTopic('')
    setSelectedAudienceId(DEFAULT_AUDIENCE.id)
    setAudiences(AUDIENCES)
    setBuilding(false)
    setNaming(false)
    setBuilderName('')
    setBuilderFilters([])
    const d = new Date()
    d.setDate(d.getDate() + 3)
    d.setHours(10, 0, 0, 0)
    setDate(d)
    setTimeSlot('10')
    setCustomTime('10:00')
    setCampaignName('')
    setTone('Neutral')
    setMessage('')
    setUndoText(null)
    setBiasChecked(false)
    setBiasHits([])
    setBiasChecking(false)
    setProcessing(false)
    setSuccess(false)
  }

  useEffect(() => {
    if (open) return
    const t = setTimeout(reset, 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const isCustomTopicEntry = step === 1 && topicId === 'custom'

  const canContinue = (): boolean => {
    if (step === 1) {
      if (topicId === 'custom') return customTopic.trim().length >= 3
      return topicId !== null
    }
    if (step === 2) {
      if (building)
        return naming ? builderName.trim().length > 0 : builderCount > 0
      return true
    }
    if (step === 3)
      return (
        campaignName.trim().length > 0 && scheduledAt !== null && !violates48h
      )
    if (step === 4)
      return message.trim().length > 0 && message.length <= SMS_CHAR_LIMIT
    return true
  }

  const handleContinue = () => {
    if (step === 2 && building) {
      if (!naming) {
        if (!builderName.trim())
          setBuilderName(`Custom list (${builderFilters.length} filters)`)
        setNaming(true)
        return
      }
      const list: Audience = {
        id: `custom-${builderFilters.join('-')}`,
        name: builderName.trim().slice(0, 40),
        count: builderCount,
        filters: builderFilters,
      }
      setAudiences((prev) => [list, ...prev])
      setSelectedAudienceId(list.id)
      setBuilding(false)
      setNaming(false)
      setBuilderName('')
      setBuilderFilters([])
      setStep(3)
      return
    }
    setStep((s) => (s + 1) as Step)
  }

  const handleBack = () => {
    if (isCustomTopicEntry) {
      setTopicId(null)
      setCustomTopic('')
      return
    }
    if (step === 2 && building) {
      if (naming) {
        setNaming(false)
        return
      }
      setBuilding(false)
      setBuilderName('')
      setBuilderFilters([])
      return
    }
    setStep((s) => Math.max(1, s - 1) as Step)
  }

  const handlePay = () => {
    if (!scheduledAt) return
    setProcessing(true)
    setTimeout(() => {
      setProcessing(false)
      setSuccess(true)
      onScheduled({
        name: campaignName.trim(),
        audience: selectedAudience,
        sendAt: scheduledAt,
        message,
        cost,
        topicId: topicId ?? 'custom',
        topicLabel: activeTopicLabel,
      })
    }, 900)
  }

  const stepTitle = success
    ? 'Done'
    : step === 1
      ? isCustomTopicEntry
        ? 'Write your own topic'
        : 'What do you want to learn?'
      : step === 2
        ? 'Who are you polling?'
        : step === 3
          ? 'When to send?'
          : step === 4
            ? 'What do you want to say?'
            : 'Review and send'

  const showBack = (step > 1 || building || isCustomTopicEntry) && !success
  const showFooter = (step !== 1 || isCustomTopicEntry) && !success

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="flex h-[calc(100dvh-4rem)] flex-col p-0 data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-4rem)] lg:h-[calc(100dvh-8rem)] lg:data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-8rem)]">
        <DrawerHandle />
        <DrawerHeader className="sr-only">
          <DrawerTitle>{stepTitle}</DrawerTitle>
        </DrawerHeader>

        <div className="border-border shrink-0 border-b px-4 py-3 lg:px-6 lg:py-4">
          <div className="mx-auto w-full max-w-[608px]">
            <div className="relative flex items-center gap-2 lg:block">
              {showBack && (
                <div className="absolute top-1/2 right-full mr-9 hidden -translate-y-1/2 lg:block">
                  <Button variant="outline" size="small" onClick={handleBack}>
                    <ArrowLeftIcon className="size-4" />
                    Back
                  </Button>
                </div>
              )}
              <div className="size-8 shrink-0 lg:hidden">
                {showBack && (
                  <IconButton
                    variant="outline"
                    size="small"
                    aria-label="Back"
                    onClick={handleBack}
                  >
                    <ArrowLeftIcon className="size-4" />
                  </IconButton>
                )}
              </div>
              <h2 className="text-foreground min-w-0 flex-1 truncate pr-8 text-lg font-semibold lg:pr-0">
                {stepTitle}
              </h2>
            </div>
            {!success && (
              <Stepper
                variant="bar"
                currentStep={step}
                totalSteps={5}
                className="mt-2 lg:mt-3"
              />
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 lg:px-6">
          <div className="mx-auto w-full max-w-[608px]">
            {success ? (
              <SuccessScreen
                audience={selectedAudience}
                sendAt={scheduledAt}
                onClose={() => onOpenChange(false)}
              />
            ) : step === 1 ? (
              <StepTopic
                selected={topicId}
                onSelect={(id) => {
                  setTopicId(id)
                  if (id !== 'custom') setStep(2)
                }}
                customTopic={customTopic}
                setCustomTopic={setCustomTopic}
              />
            ) : step === 2 ? (
              <StepWho
                audiences={audiences}
                selectedId={selectedAudienceId}
                onSelect={setSelectedAudienceId}
                building={building}
                naming={naming}
                setBuilding={setBuilding}
                builderName={builderName}
                setBuilderName={setBuilderName}
                builderFilters={builderFilters}
                setBuilderFilters={setBuilderFilters}
                builderCount={builderCount}
                topicLabel={activeTopicLabel}
              />
            ) : step === 3 ? (
              <StepWhen
                name={campaignName}
                setName={setCampaignName}
                date={date}
                setDate={setDate}
                timeSlot={timeSlot}
                setTimeSlot={setTimeSlot}
                customTime={customTime}
                setCustomTime={setCustomTime}
                earliestSend={earliestSend}
                violates48h={violates48h}
              />
            ) : step === 4 ? (
              <StepWhat
                audience={selectedAudience}
                tone={tone}
                setTone={setTone}
                loadingDraft={loadingDraft}
                onRegenerate={regenerate}
                message={message}
                setMessage={editMessage}
                onPolish={handlePolish}
                polishing={polishing}
                undoText={undoText}
                onUndo={handleUndo}
                onBiasCheck={runBiasCheck}
                biasChecking={biasChecking}
                biasChecked={biasChecked}
                biasHits={biasHits}
              />
            ) : (
              <StepReview
                audience={selectedAudience}
                scheduledAt={scheduledAt}
                message={message}
                cost={cost}
                topicLabel={activeTopicLabel}
              />
            )}
          </div>
        </div>

        {showFooter && (
          <div className="border-border bg-background shrink-0 border-t px-4 py-3 lg:px-6">
            <div className="mx-auto w-full max-w-[608px]">
              {step < 5 ? (
                <Button
                  className="w-full"
                  disabled={!canContinue()}
                  onClick={handleContinue}
                >
                  {step === 2 && building && !naming
                    ? `Continue (${builderCount.toLocaleString()})`
                    : 'Continue'}
                </Button>
              ) : (
                <Button
                  className="w-full"
                  disabled={processing}
                  onClick={handlePay}
                >
                  {processing ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Processing…
                    </>
                  ) : (
                    `Pay $${formatMoney(cost)}`
                  )}
                </Button>
              )}
            </div>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  )
}

// ---------- Step 1: Topic ----------
const StepTopic = ({
  selected,
  onSelect,
  customTopic,
  setCustomTopic,
}: {
  selected: PollTopicId | null
  onSelect: (id: PollTopicId) => void
  customTopic: string
  setCustomTopic: (v: string) => void
}) => {
  if (selected === 'custom') {
    return (
      <div className="space-y-6">
        <Intro
          title="Write your own topic"
          body="Describe the community issue you want to poll on."
        />
        <div className="space-y-2">
          <Label htmlFor="poll-custom-topic">Your topic</Label>
          <Textarea
            id="poll-custom-topic"
            value={customTopic}
            onChange={(e) => setCustomTopic(e.target.value)}
            placeholder="e.g. Should the city extend library hours on weekends?"
            className="min-h-[120px] resize-none [field-sizing:content]"
            maxLength={200}
            autoFocus
          />
          <p className="text-muted-foreground text-xs">
            {customTopic.length}/200
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Intro
        title="What do you want to learn?"
        body="Pick a community issue to poll on, or write your own topic."
      />
      <div className="space-y-3">
        {POLL_TOPICS.map((t) => {
          const active = t.id === selected
          return (
            <Card
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(t.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(t.id)
                }
              }}
              className={cn(
                'flex-row items-center justify-between gap-3 rounded-lg p-4 shadow-none transition-colors',
                active ? 'border-primary bg-muted' : 'hover:border-primary/50',
              )}
            >
              <span className="text-foreground font-medium">{t.label}</span>
              <ChevronRight className="text-muted-foreground size-5 shrink-0" />
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ---------- Step 2: Who ----------
const StepWho = ({
  audiences,
  selectedId,
  onSelect,
  building,
  naming,
  setBuilding,
  builderName,
  setBuilderName,
  builderFilters,
  setBuilderFilters,
  builderCount,
  topicLabel,
}: {
  audiences: Audience[]
  selectedId: string
  onSelect: (id: string) => void
  building: boolean
  naming: boolean
  setBuilding: (v: boolean) => void
  builderName: string
  setBuilderName: (v: string) => void
  builderFilters: string[]
  setBuilderFilters: (v: string[]) => void
  builderCount: number
  topicLabel: string
}) => {
  const [open, setOpen] = useState(false)
  const active = audiences.find((a) => a.id === selectedId) ?? DEFAULT_AUDIENCE
  const recommended = audiences.find(
    (a) => a.id === POLL_RECOMMENDATION.audienceId,
  )
  const recSelected = selectedId === POLL_RECOMMENDATION.audienceId
  const hasFilters = builderFilters.length > 0

  if (building && naming) {
    return (
      <div className="space-y-6">
        <Intro title="Name your list" body="You can rename it any time." />
        <div className="space-y-2">
          <Label htmlFor="poll-list-name">List name</Label>
          <Input
            id="poll-list-name"
            value={builderName}
            onChange={(e) => setBuilderName(e.target.value)}
            placeholder="Name this list"
            maxLength={40}
            autoFocus
          />
          <p className="text-muted-foreground text-xs">
            {builderName.length}/40
          </p>
        </div>
      </div>
    )
  }

  if (building) {
    return (
      <div className="space-y-6">
        <Intro
          title="Build a voter list"
          body="Pick filters to define who this poll reaches."
        />
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <SectionLabel>Filters</SectionLabel>
            {hasFilters && (
              <Button
                variant="link"
                size="small"
                className="h-auto px-0"
                onClick={() => setBuilderFilters([])}
              >
                Clear filters
              </Button>
            )}
          </div>
          {FILTER_POOLS.map((group) => (
            <div key={group.key} className="space-y-2">
              <SectionLabel>{group.label}</SectionLabel>
              <FilterPillGroup
                type="multiple"
                value={builderFilters.filter((f) => group.options.includes(f))}
                onValueChange={(vals) =>
                  setBuilderFilters([
                    ...builderFilters.filter((f) => !group.options.includes(f)),
                    ...vals,
                  ])
                }
              >
                {group.options.map((opt) => (
                  <FilterPill key={opt} value={opt}>
                    {opt}
                  </FilterPill>
                ))}
              </FilterPillGroup>
            </div>
          ))}
        </div>
        <p className="text-muted-foreground text-sm">
          Estimated reach: {builderCount.toLocaleString()} voters
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Intro
        title="Who do you want to reach?"
        body={`We recommend reaching voters who flagged ${topicLabel.toLowerCase() || 'this topic'}.`}
      />

      {recommended && (
        <div className="space-y-2">
          <p className="text-primary flex items-center gap-1.5 text-xs font-bold uppercase">
            <Sparkles className="size-3.5" />
            Recommended list
          </p>
          <Card
            role="button"
            tabIndex={0}
            onClick={() => onSelect(recommended.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(recommended.id)
              }
            }}
            className={cn(
              'cursor-pointer flex-row items-center justify-between gap-3 rounded-lg p-4 shadow-none transition-colors',
              recSelected
                ? 'border-primary bg-muted'
                : 'hover:border-primary/50',
            )}
          >
            <div className="min-w-0">
              <p className="text-foreground truncate font-medium">
                {POLL_RECOMMENDATION.title}
              </p>
              <p className="text-muted-foreground truncate text-sm">
                Reach {POLL_RECOMMENDATION.reach.toLocaleString()} voters
              </p>
            </div>
            {recSelected && <Check className="text-primary size-5 shrink-0" />}
          </Card>
        </div>
      )}

      <div className="space-y-2">
        <SectionLabel>All lists</SectionLabel>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Card
              role="button"
              tabIndex={0}
              className="cursor-pointer flex-row items-center justify-between gap-3 rounded-lg p-4 shadow-none"
            >
              <div className="min-w-0">
                <p className="text-foreground truncate font-medium">
                  {active.name}
                </p>
                <p className="text-muted-foreground text-sm">
                  Poll {active.count.toLocaleString()} voters for $
                  {formatMoney(active.count * POLL_COST_PER_RECIPIENT)}
                </p>
              </div>
              <ChevronDown
                className={cn(
                  'text-muted-foreground size-5 shrink-0 transition-transform',
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
            <div className="divide-border divide-y">
              <button
                type="button"
                onClick={() => {
                  setBuilding(true)
                  setOpen(false)
                }}
                className="hover:bg-muted flex w-full items-center gap-3 p-4 text-left transition-colors"
              >
                <span className="bg-primary-light flex size-8 shrink-0 items-center justify-center rounded-full">
                  <Plus className="text-primary size-4" />
                </span>
                <span className="min-w-0">
                  <span className="text-primary block font-medium">
                    Create a new list
                  </span>
                  <span className="text-muted-foreground block text-sm">
                    Build a custom audience
                  </span>
                </span>
              </button>
              {audiences.map((a) => {
                const on = a.id === selectedId
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      onSelect(a.id)
                      setOpen(false)
                    }}
                    className={cn(
                      'hover:bg-muted flex w-full items-center justify-between gap-3 p-4 text-left transition-colors',
                      on && 'bg-muted',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="text-foreground block truncate font-medium">
                        {a.name}
                      </span>
                      <span className="text-muted-foreground block text-sm">
                        Poll {a.count.toLocaleString()} voters for $
                        {formatMoney(a.count * POLL_COST_PER_RECIPIENT)}
                      </span>
                    </span>
                    {on && <Check className="text-primary size-5 shrink-0" />}
                  </button>
                )
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <p className="text-muted-foreground text-sm">
        Each poll message costs ${POLL_COST_PER_RECIPIENT.toFixed(3)}
      </p>
    </div>
  )
}

// ---------- Step 3: When ----------
const StepWhen = ({
  name,
  setName,
  date,
  setDate,
  timeSlot,
  setTimeSlot,
  customTime,
  setCustomTime,
  earliestSend,
  violates48h,
}: {
  name: string
  setName: (v: string) => void
  date: Date | undefined
  setDate: (d: Date | undefined) => void
  timeSlot: string
  setTimeSlot: (v: string) => void
  customTime: string
  setCustomTime: (v: string) => void
  earliestSend: number
  violates48h: boolean
}) => {
  const [calOpen, setCalOpen] = useState(false)
  const tz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return 'Local time'
    }
  }, [])
  const todayStart = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])
  const earliestDay = useMemo(() => {
    const d = new Date(earliestSend)
    d.setHours(0, 0, 0, 0)
    return d
  }, [earliestSend])

  return (
    <div className="space-y-6">
      <Intro
        title="When do you want to send it?"
        body="Sends require at least 48 hours' notice."
      />

      <div className="space-y-2">
        <Label htmlFor="poll-name">Campaign name</Label>
        <Input
          id="poll-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Housing poll — July"
          maxLength={60}
        />
        <p className="text-muted-foreground text-sm">
          Internal name to identify this poll in your history.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Send date</Label>
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  'border-components-input-border bg-components-input-base hover:bg-muted text-foreground w-full justify-start rounded-md px-3 text-base font-normal md:text-sm',
                  !date && 'text-muted-foreground',
                  violates48h && 'border-destructive text-destructive',
                )}
              >
                <CalendarIcon className="text-muted-foreground size-4" />
                {date ? fmtDate(date) : 'Pick a date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                selected={date}
                onSelect={(d) => {
                  setDate(d ?? undefined)
                  setCalOpen(false)
                }}
                disabled={(day) => day < earliestDay}
                modifiers={{
                  tooSoon: (day) => day >= todayStart && day < earliestDay,
                }}
                modifiersClassNames={{
                  tooSoon: 'text-destructive/70 line-through',
                }}
                initialFocus
              />
              <div className="border-border text-muted-foreground border-t px-3 py-2 text-xs">
                Dates in red require more than 48 hours' notice and can't be
                scheduled.
              </div>
            </PopoverContent>
          </Popover>
          <p className="text-muted-foreground text-sm">
            Earliest send: {fmtDateTime(new Date(earliestSend))}.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Send time</Label>
          <Select value={timeSlot} onValueChange={setTimeSlot}>
            <SelectTrigger
              className={cn(
                'w-full',
                violates48h && 'border-destructive text-destructive',
              )}
            >
              <Clock className="text-muted-foreground size-4" />
              <SelectValue placeholder="Select time" />
            </SelectTrigger>
            <SelectContent>
              {TIME_OPTIONS.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {timeSlot === 'custom' && (
            <Input
              type="time"
              value={customTime}
              onChange={(e) => setCustomTime(e.target.value)}
            />
          )}
          <p className="text-muted-foreground text-sm">{tz}</p>
        </div>
      </div>

      {violates48h && (
        <Alert variant="destructive" icon={<AlertCircle />}>
          <AlertDescription>
            Sends need at least 48 hours' notice. Pick a date and time on or
            after {fmtDateTime(new Date(earliestSend))}.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

// ---------- Step 4: What ----------
const StepWhat = ({
  audience,
  tone,
  setTone,
  loadingDraft,
  onRegenerate,
  message,
  setMessage,
  onPolish,
  polishing,
  undoText,
  onUndo,
  onBiasCheck,
  biasChecking,
  biasChecked,
  biasHits,
}: {
  audience: Audience
  tone: PollTone
  setTone: (t: PollTone) => void
  loadingDraft: boolean
  onRegenerate: () => void
  message: string
  setMessage: (v: string) => void
  onPolish: () => void
  polishing: boolean
  undoText: string | null
  onUndo: () => void
  onBiasCheck: () => void
  biasChecking: boolean
  biasChecked: boolean
  biasHits: string[]
}) => {
  const { recording, supported, start, stop } = useSpeechDictation({
    onFinal: (chunk) =>
      setMessage((message ? `${message.trimEnd()} ` : '') + chunk),
  })
  const segments = Math.max(1, Math.ceil(message.length / 160))
  const overLimit = message.length > SMS_CHAR_LIMIT
  const biasDetected = biasChecked && biasHits.length > 0
  const biasClean = biasChecked && biasHits.length === 0

  const handleDictate = () => {
    if (recording) stop()
    else if (supported) start()
    else toast("Voice input isn't supported in this browser.")
  }

  return (
    <div className="space-y-6">
      <Intro
        title="What do you want to say?"
        body="Ask a single, clear question. Neutral wording gets better responses."
      />

      <div className="space-y-3">
        <FilterPillGroup
          type="single"
          value={tone}
          onValueChange={(v) => v && setTone(v as PollTone)}
        >
          {POLL_TONES.map((t) => {
            const ToneIcon = POLL_TONE_ICONS[t]
            return (
              <FilterPill key={t} value={t} className="gap-1.5">
                <ToneIcon className="size-4" />
                {t}
              </FilterPill>
            )
          })}
        </FilterPillGroup>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            Suggested for {audience.name}
          </p>
          <Button
            variant="link"
            size="small"
            className="h-auto gap-1.5 px-0"
            disabled={loadingDraft}
            onClick={onRegenerate}
          >
            {loadingDraft ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Regenerate
          </Button>
        </div>
      </div>

      {loadingDraft && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-3.5 animate-spin" /> Drafting a question…
        </p>
      )}

      <Card className="gap-0 p-4 shadow-none">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-muted-foreground text-xs font-medium">
            Your question
          </span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {message.length} chars · {segments} SMS
          </span>
        </div>
        <p className="text-muted-foreground mb-2 text-xs">
          {renderWithMergeVars('Hello, {first_name}')}
        </p>
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Write your poll question…"
          className="min-h-[140px] resize-none border-0 p-0 shadow-none focus-visible:ring-0 [field-sizing:content]"
        />
        <p className="text-muted-foreground mt-3 text-xs">{OPT_OUT_FOOTER}</p>

        <div className="border-border -mx-4 -mb-4 mt-4 flex items-center justify-end gap-1 border-t p-2">
          {undoText !== null && (
            <Button
              variant="link"
              size="small"
              className="h-auto px-2"
              onClick={onUndo}
            >
              Undo
            </Button>
          )}
          <Button
            variant="ghost"
            size="small"
            className="text-muted-foreground gap-1.5"
            onClick={onPolish}
            disabled={polishing || !message.trim()}
          >
            {polishing ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Improving…
              </>
            ) : (
              <>
                <Sparkles className="size-4" /> Improve with AI
              </>
            )}
          </Button>
          <Button
            variant={biasDetected ? 'destructive' : 'ghost'}
            size="small"
            className={cn(
              'gap-1.5',
              !biasDetected && 'text-muted-foreground',
              biasClean && 'text-success-dark',
            )}
            onClick={onBiasCheck}
            disabled={biasChecking || !message.trim()}
          >
            {biasChecking ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Checking…
              </>
            ) : biasDetected ? (
              <>
                <ShieldAlert className="size-4" /> Bias detected
              </>
            ) : biasClean ? (
              <>
                <ShieldCheck className="size-4" /> No bias detected
              </>
            ) : (
              <>
                <ShieldCheck className="size-4" /> Check for bias
              </>
            )}
          </Button>
          <IconButton
            variant={recording ? 'destructive' : 'ghost'}
            size="small"
            aria-label={recording ? 'Stop dictation' : 'Dictate'}
            onClick={handleDictate}
          >
            {recording ? (
              <Square className="size-4 fill-current" />
            ) : (
              <Mic className="size-5" />
            )}
          </IconButton>
        </div>
      </Card>

      {biasDetected && (
        <Alert variant="destructive" icon={<ShieldAlert />}>
          <AlertTitle>Loaded language may bias responses.</AlertTitle>
          <AlertDescription>
            Consider rewording: {biasHits.join(', ')}
          </AlertDescription>
        </Alert>
      )}

      {message.trim().length > 0 && !hasIntro(message) && (
        <p className="text-muted-foreground text-xs">
          Tip: open with your name so recipients know who's asking, e.g. "
          {pollIntroFor()}"
        </p>
      )}

      {overLimit && (
        <p className="text-destructive text-xs">
          Messages over 3 SMS segments (480 chars) may be split by carriers.
        </p>
      )}
    </div>
  )
}

// ---------- Step 5: Review ----------
const StepReview = ({
  audience,
  scheduledAt,
  message,
  cost,
  topicLabel,
}: {
  audience: Audience
  scheduledAt: Date | null
  message: string
  cost: number
  topicLabel: string
}) => {
  const [preview, setPreview] = useState(false)
  return (
    <div className="space-y-6">
      <Intro
        title="Review & pay"
        body="Review your poll details and complete your payment."
      />

      <Card className="gap-0 overflow-hidden p-0 shadow-none">
        <Accordion type="single" collapsible defaultValue="details">
          <AccordionItem value="details" className="border-none">
            <AccordionTrigger className="px-4 py-4 hover:no-underline">
              <div className="flex items-center gap-3 text-left">
                <span
                  className={cn(
                    'flex size-12 shrink-0 items-center justify-center rounded-full',
                    CHANNEL_ICON_TINT.polls,
                  )}
                >
                  <PollChannelIcon className="text-foreground size-6" />
                </span>
                <div>
                  <p className="text-foreground font-medium">Poll</p>
                  <p className="text-foreground text-sm font-normal">
                    Send date: {scheduledAt ? fmtDate(scheduledAt) : '—'}
                  </p>
                  <p className="text-foreground text-sm font-normal">
                    Send time:{' '}
                    {scheduledAt
                      ? scheduledAt.toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                        })
                      : '—'}
                  </p>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-foreground">Topic</dt>
                  <dd className="text-foreground">{topicLabel}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-foreground">Recipients</dt>
                  <dd className="text-foreground">
                    {audience.count.toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-foreground">Price per message</dt>
                  <dd className="text-foreground">
                    ${POLL_COST_PER_RECIPIENT.toFixed(3)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-foreground">Audience</dt>
                  <dd className="text-foreground">{audience.name}</dd>
                </div>
              </dl>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        <div className="border-border flex items-center justify-between border-t px-4 py-4">
          <span className="text-foreground font-medium">Total</span>
          <span className="text-foreground font-semibold">
            ${formatMoney(cost)}
          </span>
        </div>
      </Card>

      <Button
        variant="outline"
        className="w-full"
        disabled={!message.trim()}
        onClick={() => setPreview((v) => !v)}
      >
        <Eye className="size-4" />
        {preview ? 'Hide preview' : 'Preview poll'}
      </Button>

      {preview && (
        <div className="flex justify-center">
          <div className="bg-primary text-primary-foreground w-full max-w-[280px] rounded-2xl rounded-bl-sm p-3 text-sm">
            <p className="whitespace-pre-wrap">
              {renderWithMergeVars('Hello, {first_name}')}
              {message ? `\n\n${message}` : ''}
              {!messageEndsWithOptOut(message) && `\n\n${OPT_OUT_FOOTER}`}
            </p>
          </div>
        </div>
      )}

      <Card className="gap-3 p-4 shadow-none">
        <p className="text-foreground font-semibold">Payment details</p>
        <div className="space-y-1.5">
          <Label>Card number</Label>
          <Input readOnly value="•••• •••• •••• 4242" />
        </div>
        <div className="flex gap-3">
          <div className="flex-1 space-y-1.5">
            <Label>Expiration</Label>
            <Input readOnly value="10/28" />
          </div>
          <div className="flex-1 space-y-1.5">
            <Label>CVC</Label>
            <Input readOnly value="•••" />
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          Billed by Text Message Center. This is a demo — no real payment is
          taken.
        </p>
      </Card>
    </div>
  )
}

// ---------- Success ----------
const SuccessScreen = ({
  audience,
  sendAt,
  onClose,
}: {
  audience: Audience
  sendAt: Date | null
  onClose: () => void
}) => (
  <div className="space-y-6 py-8 text-center">
    <div className="flex justify-center">
      <span className="bg-primary-light flex size-16 items-center justify-center rounded-full">
        <CheckCircle2 className="text-primary size-8" />
      </span>
    </div>
    <div className="space-y-2">
      <h2 className="text-foreground text-2xl font-semibold">
        Poll scheduled!
      </h2>
      <p className="text-muted-foreground">
        Your poll will reach {audience.count.toLocaleString()} recipients
        {sendAt ? ` on ${fmtDate(sendAt)}.` : ' shortly.'}
      </p>
    </div>
    <Button size="large" className="w-full" onClick={onClose}>
      Done
    </Button>
  </div>
)

const Intro = ({ title, body }: { title: string; body: string }) => (
  <div className="space-y-2">
    <h3 className="text-foreground text-xl font-semibold">{title}</h3>
    <p className="text-muted-foreground text-base">{body}</p>
  </div>
)
