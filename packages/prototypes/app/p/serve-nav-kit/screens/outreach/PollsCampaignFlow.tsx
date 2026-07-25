'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
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
} from '@goodparty_org/styleguide'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import { SectionLabel } from '../../components/SectionLabel'
import { FILTER_POOLS, TIME_OPTIONS, formatMoney } from './smsData'
import {
  type Audience,
  type PollTone,
  type PollTopicId,
  AUDIENCES,
  DEFAULT_AUDIENCE,
  POLL_COST_PER_RECIPIENT,
  POLL_RECOMMENDATION,
  POLL_TONE_ICONS,
  POLL_TONES,
  POLL_TOPICS,
  detectBias,
  estimateAudienceSize,
  generatePollQuestion,
} from './pollData'
import { CHANNEL_ICON, CHANNEL_ICON_TINT } from './data'

// Review header reuses the channel card's icon + tint (single source of truth).
const PollChannelIcon = CHANNEL_ICON.polls

export type ScheduledPoll = {
  name: string
  audience: Audience
  sendAt: Date
  question: string
  cost: number
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
  const [topic, setTopic] = useState<PollTopicId | null>(null)

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
  const [question, setQuestion] = useState('')

  const [processing, setProcessing] = useState(false)
  const [success, setSuccess] = useState(false)

  const selectedAudience = useMemo(
    () =>
      audiences.find((a) => a.id === selectedAudienceId) ?? DEFAULT_AUDIENCE,
    [audiences, selectedAudienceId],
  )
  const cost = selectedAudience.count * POLL_COST_PER_RECIPIENT
  const biasHits = useMemo(() => detectBias(question), [question])

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

  const lastAutoName = useRef('')
  useEffect(() => {
    const def = `${selectedAudience.name} — Poll${date ? `, ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`
    if (campaignName === '' || campaignName === lastAutoName.current) {
      setCampaignName(def)
      lastAutoName.current = def
    }
  }, [selectedAudience, date, campaignName])

  useEffect(() => {
    if (step !== 4 || question.trim()) return
    if (topic === 'custom') return
    setLoadingDraft(true)
    const t = setTimeout(() => {
      setQuestion(generatePollQuestion(topic ?? 'affordable-housing'))
      setLoadingDraft(false)
    }, 650)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const regenerate = () => {
    if (!topic || topic === 'custom') return
    setLoadingDraft(true)
    setTimeout(() => {
      setQuestion(generatePollQuestion(topic))
      setLoadingDraft(false)
    }, 650)
  }

  const reset = () => {
    setStep(1)
    setTopic(null)
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
    setQuestion('')
    setProcessing(false)
    setSuccess(false)
  }

  useEffect(() => {
    if (open) return
    const t = setTimeout(reset, 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const canContinue = (): boolean => {
    if (step === 1) return topic !== null
    if (step === 2) {
      if (building)
        return naming ? builderName.trim().length > 0 : builderCount > 0
      return true
    }
    if (step === 3)
      return (
        campaignName.trim().length > 0 && scheduledAt !== null && !violates48h
      )
    if (step === 4) return question.trim().length > 0
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
        question,
        cost,
      })
    }, 900)
  }

  const stepTitle = success
    ? 'Done'
    : step === 1
      ? 'What do you want to ask?'
      : step === 2
        ? 'Who are you polling?'
        : step === 3
          ? 'When do you want to send?'
          : step === 4
            ? 'Write your question'
            : 'Review and send'

  const showBack = (step > 1 || building) && !success
  const showFooter = step !== 1 && !success

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
                selected={topic}
                onSelect={(id) => {
                  setTopic(id)
                  setStep(2)
                }}
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
              <StepQuestion
                audience={selectedAudience}
                tone={tone}
                setTone={setTone}
                loadingDraft={loadingDraft}
                onRegenerate={regenerate}
                question={question}
                setQuestion={setQuestion}
                biasHits={biasHits}
              />
            ) : (
              <StepReview
                audience={selectedAudience}
                scheduledAt={scheduledAt}
                question={question}
                cost={cost}
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
}: {
  selected: PollTopicId | null
  onSelect: (id: PollTopicId) => void
}) => (
  <div className="space-y-6">
    <Intro
      title="What do you want to ask?"
      body="Pick a topic and we'll draft a neutral poll question."
    />
    <div className="space-y-3">
      {POLL_TOPICS.map((p) => {
        const active = p.id === selected
        return (
          <Card
            key={p.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(p.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(p.id)
              }
            }}
            className={cn(
              'flex-row items-center justify-between gap-3 rounded-lg p-4 shadow-none transition-colors',
              active ? 'border-primary bg-muted' : 'hover:border-primary/50',
            )}
          >
            <span className="text-foreground font-medium">{p.label}</span>
            <ChevronRight className="text-muted-foreground size-5 shrink-0" />
          </Card>
        )
      })}
    </div>
  </div>
)

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
}) => {
  const [open, setOpen] = useState(false)
  const active = audiences.find((a) => a.id === selectedId) ?? DEFAULT_AUDIENCE
  const recommended = audiences.find(
    (a) => a.id === POLL_RECOMMENDATION.audienceId,
  )
  const recSelected = selectedId === POLL_RECOMMENDATION.audienceId

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
        body="We recommend reaching all voters to increase awareness."
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
        Each response costs ${POLL_COST_PER_RECIPIENT.toFixed(3)}
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
  const earliestDay = useMemo(() => {
    const d = new Date(earliestSend)
    d.setHours(0, 0, 0, 0)
    return d
  }, [earliestSend])

  return (
    <div className="space-y-6">
      <Intro
        title="When do you want to send it?"
        body="We recommend mid-morning or early evening. Sends require at least 48 hours' notice."
      />

      <div className="space-y-2">
        <Label htmlFor="poll-name">Campaign name</Label>
        <Input
          id="poll-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Housing sentiment poll"
          maxLength={60}
        />
        <p className="text-muted-foreground text-sm">
          Internal name to identify this campaign in your history.
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
                initialFocus
              />
            </PopoverContent>
          </Popover>
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

// ---------- Step 4: Question ----------
const StepQuestion = ({
  audience,
  tone,
  setTone,
  loadingDraft,
  onRegenerate,
  question,
  setQuestion,
  biasHits,
}: {
  audience: Audience
  tone: PollTone
  setTone: (t: PollTone) => void
  loadingDraft: boolean
  onRegenerate: () => void
  question: string
  setQuestion: (v: string) => void
  biasHits: string[]
}) => (
  <div className="space-y-6">
    <Intro
      title="Write your question"
      body="Ask a single, clear question. Neutral wording gets better responses."
    />

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

    <div className="space-y-2">
      <Label htmlFor="poll-question">Poll question</Label>
      <Textarea
        id="poll-question"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Ask one clear question…"
        className="min-h-[120px] resize-none [field-sizing:content]"
      />
    </div>

    {biasHits.length > 0 && (
      <Alert variant="default" icon={<AlertTriangle />}>
        <AlertTitle>Loaded wording detected</AlertTitle>
        <AlertDescription>
          Consider rephrasing — “{biasHits.join('”, “')}” can bias responses.
          Neutral questions get more honest answers.
        </AlertDescription>
      </Alert>
    )}
  </div>
)

// ---------- Step 5: Review ----------
const StepReview = ({
  audience,
  scheduledAt,
  question,
  cost,
}: {
  audience: Audience
  scheduledAt: Date | null
  question: string
  cost: number
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
                  <dt className="text-foreground">Recipients</dt>
                  <dd className="text-foreground">
                    {audience.count.toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-foreground">Price per response</dt>
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
        disabled={!question.trim()}
        onClick={() => setPreview((v) => !v)}
      >
        <Eye className="size-4" />
        {preview ? 'Hide preview' : 'Preview question'}
      </Button>

      {preview && (
        <Card className="gap-1 p-4 shadow-none">
          <SectionLabel>Poll question</SectionLabel>
          <p className="text-foreground text-sm leading-6">{question}</p>
        </Card>
      )}
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
        Payment successful!
      </h2>
      <p className="text-muted-foreground">
        Your poll has been scheduled and will reach{' '}
        {audience.count.toLocaleString()} recipients
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
