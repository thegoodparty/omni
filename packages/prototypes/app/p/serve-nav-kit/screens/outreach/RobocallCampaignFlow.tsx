'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  Calendar as CalendarIcon,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  Mic,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  AlertDescription,
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
import { FILTER_POOLS, TIME_OPTIONS, formatMoney } from './smsData'
import {
  type Audience,
  type RobocallPurposeId,
  type Tone,
  AUDIENCES,
  DEFAULT_AUDIENCE,
  PAID_FOR_DISCLAIMER,
  ROBOCALL_COST_PER_RECIPIENT,
  ROBOCALL_LEGAL_NOTE,
  ROBOCALL_PURPOSES,
  ROBOCALL_RECOMMENDATION,
  TONES,
  TONE_ICONS,
  estimateAudienceSize,
  fmtDuration,
  generateScript,
} from './robocallData'

// Review header reuses the channel card's icon + tint (single source of truth).
const RobocallIcon = CHANNEL_ICON.robocall

export type ScheduledRobocall = {
  name: string
  audience: Audience
  sendAt: Date
  script: string
  recordingUrl: string | null
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
  onScheduled: (result: ScheduledRobocall) => void
}

export const RobocallCampaignFlow = ({
  open,
  onOpenChange,
  onScheduled,
}: Props) => {
  const [step, setStep] = useState<Step>(1)
  const [purpose, setPurpose] = useState<RobocallPurposeId | null>(null)

  const [audiences, setAudiences] = useState<Audience[]>(AUDIENCES)
  const [selectedAudienceId, setSelectedAudienceId] = useState(
    DEFAULT_AUDIENCE.id,
  )
  const [building, setBuilding] = useState(false)
  const [naming, setNaming] = useState(false)
  const [builderName, setBuilderName] = useState('')
  const [builderFilters, setBuilderFilters] = useState<string[]>([])
  // No filters selected means no list yet — keep the count at 0 so Continue
  // stays disabled (an empty filter set otherwise reads as the full universe).
  const builderCount = useMemo(
    () =>
      builderFilters.length === 0 ? 0 : estimateAudienceSize(builderFilters),
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

  const [tone, setTone] = useState<Tone>('Warm')
  const [loadingScript, setLoadingScript] = useState(false)
  const seedRef = useRef(0)
  const [script, setScript] = useState('')

  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [recordingSaved, setRecordingSaved] = useState(false)

  const [processing, setProcessing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [recordSlotNode, setRecordSlotNode] = useState<HTMLDivElement | null>(
    null,
  )

  const selectedAudience = useMemo(
    () =>
      audiences.find((a) => a.id === selectedAudienceId) ?? DEFAULT_AUDIENCE,
    [audiences, selectedAudienceId],
  )
  const cost = selectedAudience.count * ROBOCALL_COST_PER_RECIPIENT

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

  // "Send now" can't satisfy a robocall's 48-hour minimum, so it trips the same
  // notice instead of silently disabling Continue with no explanation.
  const violates48h =
    timeSlot === 'now' ||
    (scheduledAt ? scheduledAt.getTime() < earliestSend : false)

  const lastAutoName = useRef('')
  useEffect(() => {
    const def = `${selectedAudience.name} — Robocall${date ? `, ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`
    if (campaignName === '' || campaignName === lastAutoName.current) {
      setCampaignName(def)
      lastAutoName.current = def
    }
  }, [selectedAudience, date, campaignName])

  // Script is drafted when the record step opens (source drafts after payment).
  useEffect(() => {
    if (step !== 5 || script.trim()) return
    if (purpose === 'custom') return
    setLoadingScript(true)
    const t = setTimeout(() => {
      setScript(generateScript(purpose ?? 'introduce', tone, seedRef.current))
      setLoadingScript(false)
    }, 650)
    return () => clearTimeout(t)
  }, [step])

  const regenerate = () => {
    if (!purpose || purpose === 'custom') return
    seedRef.current += 1
    const seed = seedRef.current
    setLoadingScript(true)
    setTimeout(() => {
      setScript(generateScript(purpose, tone, seed))
      setLoadingScript(false)
    }, 650)
  }

  // Switching tone re-drafts the script with new copy.
  const handleToneChange = (t: Tone) => {
    setTone(t)
    if (purpose !== 'custom') regenerate()
  }

  const reset = () => {
    setStep(1)
    setPurpose(null)
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
    setTone('Warm')
    seedRef.current = 0
    setScript('')
    if (recordingUrl) URL.revokeObjectURL(recordingUrl)
    setRecordingUrl(null)
    setRecordingDuration(0)
    setRecordingSaved(false)
    setProcessing(false)
    setSubmitting(false)
  }

  useEffect(() => {
    if (open) return
    const t = setTimeout(reset, 200)
    return () => clearTimeout(t)
  }, [open])

  const canContinue = (): boolean => {
    if (step === 1) return purpose !== null
    if (step === 2) {
      if (building)
        return naming ? builderName.trim().length > 0 : builderCount > 0
      return true
    }
    if (step === 3)
      return (
        campaignName.trim().length > 0 && scheduledAt !== null && !violates48h
      )
    if (step === 5)
      return recordingSaved && recordingUrl !== null && recordingDuration >= 2
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

  // Pay first (step 4), then reveal the record step (step 5).
  const handlePay = () => {
    setProcessing(true)
    setTimeout(() => {
      setProcessing(false)
      setStep(5)
    }, 900)
  }

  const handleSubmit = () => {
    if (!scheduledAt) return
    setSubmitting(true)
    setTimeout(() => {
      setSubmitting(false)
      onScheduled({
        name: campaignName.trim(),
        audience: selectedAudience,
        sendAt: scheduledAt,
        script,
        recordingUrl,
        cost,
      })
      onOpenChange(false)
    }, 600)
  }

  const stepTitle =
    step === 1
      ? 'What do you want to do?'
      : step === 2
        ? 'Who are you calling?'
        : step === 3
          ? 'When to send?'
          : step === 4
            ? 'Review and pay'
            : 'Record your message'

  const showBack = (step > 1 || building) && step !== 4
  const showFooter = step !== 1

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
              <h2 className="text-foreground min-w-0 flex-1 truncate pr-8 text-base font-semibold lg:pr-0">
                {stepTitle}
              </h2>
            </div>
            <Stepper
              variant="bar"
              currentStep={step}
              totalSteps={5}
              className="mt-2 lg:mt-3"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 lg:px-6">
          <div className="mx-auto w-full max-w-[608px]">
            {step === 1 ? (
              <StepPurpose
                selected={purpose}
                onSelect={(id) => {
                  setPurpose(id)
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
              <StepReview
                audience={selectedAudience}
                scheduledAt={scheduledAt}
                cost={cost}
              />
            ) : (
              <StepRecord
                audience={selectedAudience}
                tone={tone}
                setTone={handleToneChange}
                loadingScript={loadingScript}
                onRegenerate={() => regenerate()}
                isCustom={purpose === 'custom'}
                script={script}
                setScript={setScript}
                recordingUrl={recordingUrl}
                setRecordingUrl={setRecordingUrl}
                recordingDuration={recordingDuration}
                setRecordingDuration={setRecordingDuration}
                recordingSaved={recordingSaved}
                setRecordingSaved={setRecordingSaved}
                slotNode={recordSlotNode}
              />
            )}
          </div>
        </div>

        {step === 5 && (
          <div
            ref={setRecordSlotNode}
            className="shrink-0 px-4 pt-3 pb-4 lg:px-6"
          />
        )}

        {showFooter && (
          <div className="border-border bg-background shrink-0 border-t px-4 py-3 lg:px-6">
            <div className="mx-auto w-full max-w-[608px]">
              {step < 4 ? (
                <Button
                  className="w-full"
                  disabled={!canContinue()}
                  onClick={handleContinue}
                >
                  {step === 2 && building && !naming
                    ? `Continue (${builderCount.toLocaleString()})`
                    : 'Continue'}
                </Button>
              ) : step === 4 ? (
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
              ) : (
                <Button
                  className="w-full"
                  disabled={!canContinue() || submitting}
                  onClick={handleSubmit}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Submitting…
                    </>
                  ) : (
                    'Schedule campaign'
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

// ---------- Step 1: Purpose ----------
const StepPurpose = ({
  selected,
  onSelect,
}: {
  selected: RobocallPurposeId | null
  onSelect: (id: RobocallPurposeId) => void
}) => (
  <div className="space-y-6">
    <Intro
      title="What do you want to do?"
      body="This helps us generate the best script for your robocall."
    />
    <div className="space-y-3">
      {ROBOCALL_PURPOSES.map((p) => {
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
              'flex-row items-center justify-between gap-3 rounded-lg p-4 transition-colors',
              active ? 'border-primary' : 'hover:border-primary/50',
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
}) => {
  const [open, setOpen] = useState(false)
  const active = audiences.find((a) => a.id === selectedId) ?? DEFAULT_AUDIENCE
  const recommended = audiences.find(
    (a) => a.id === ROBOCALL_RECOMMENDATION.audienceId,
  )
  const recSelected = selectedId === ROBOCALL_RECOMMENDATION.audienceId
  const hasFilters = builderFilters.length > 0

  if (building && naming) {
    return (
      <div className="space-y-6">
        <Intro title="Name your list" body="You can rename it any time." />
        <div className="space-y-2">
          <Label htmlFor="robo-list-name">List name</Label>
          <Input
            id="robo-list-name"
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
          body="Pick filters to define who this campaign reaches."
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
              'cursor-pointer flex-row items-center justify-between gap-3 rounded-lg p-4 transition-colors',
              recSelected ? 'border-primary' : 'hover:border-primary/50',
            )}
          >
            <div className="min-w-0">
              <p className="text-foreground truncate font-medium">
                {ROBOCALL_RECOMMENDATION.title}
              </p>
              <p className="text-muted-foreground truncate text-sm">
                Reach {ROBOCALL_RECOMMENDATION.reach.toLocaleString()} voters
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
              className="cursor-pointer flex-row items-center justify-between gap-3 rounded-lg p-4"
            >
              <div className="min-w-0">
                <p className="text-foreground truncate font-medium">
                  {active.name}
                </p>
                <p className="text-muted-foreground text-sm">
                  Call {active.count.toLocaleString()} voters for $
                  {formatMoney(active.count * ROBOCALL_COST_PER_RECIPIENT)}
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
                        Call {a.count.toLocaleString()} voters for $
                        {formatMoney(a.count * ROBOCALL_COST_PER_RECIPIENT)}
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
        Each call costs ${ROBOCALL_COST_PER_RECIPIENT.toFixed(3)}
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
        body="We recommend mid-morning or early evening for higher engagement. Sends require at least 48 hours' notice."
      />

      <div className="space-y-2">
        <Label htmlFor="robo-name">Campaign name</Label>
        <Input
          id="robo-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Renter outreach — May"
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
                )}
                aria-invalid={violates48h}
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
            <SelectTrigger className={cn('w-full')} aria-invalid={violates48h}>
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

// ---------- Step 4: Review & pay ----------
const StepReview = ({
  audience,
  scheduledAt,
  cost,
}: {
  audience: Audience
  scheduledAt: Date | null
  cost: number
}) => (
  <div className="space-y-6">
    <Intro
      title="Review & pay"
      body="Review your details and complete your payment. You can record your message after payment."
    />

    <Card className="gap-0 overflow-hidden p-0">
      <Accordion type="single" collapsible defaultValue="details">
        <AccordionItem value="details" className="border-none">
          <AccordionTrigger className="px-4 py-4 hover:no-underline">
            <div className="flex items-center gap-3 text-left">
              <span
                className={cn(
                  'flex size-12 shrink-0 items-center justify-center rounded-full',
                  CHANNEL_ICON_TINT.robocall,
                )}
              >
                <RobocallIcon className="text-foreground size-6" />
              </span>
              <div>
                <p className="text-foreground font-medium">Robocall</p>
                <p className="text-foreground text-sm font-normal">
                  Send date: {scheduledAt ? fmtDate(scheduledAt) : 'Send now'}
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
                <dt className="text-foreground">Price per call</dt>
                <dd className="text-foreground">
                  ${ROBOCALL_COST_PER_RECIPIENT.toFixed(3)}
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

    <Card className="gap-3 p-4">
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
        Billed by Robocall Center. This is a demo — no real payment is taken.
      </p>
    </Card>
  </div>
)

// ---------- Step 5: Record (script + record) ----------
const StepRecord = ({
  audience,
  tone,
  setTone,
  loadingScript,
  onRegenerate,
  isCustom,
  script,
  setScript,
  recordingUrl,
  setRecordingUrl,
  recordingDuration,
  setRecordingDuration,
  recordingSaved,
  setRecordingSaved,
  slotNode,
}: {
  audience: Audience
  tone: Tone
  setTone: (t: Tone) => void
  loadingScript: boolean
  onRegenerate: () => void
  isCustom: boolean
  script: string
  setScript: (v: string) => void
  recordingUrl: string | null
  setRecordingUrl: (v: string | null) => void
  recordingDuration: number
  setRecordingDuration: (v: number) => void
  recordingSaved: boolean
  setRecordingSaved: (v: boolean) => void
  slotNode: HTMLDivElement | null
}) => {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [playing, setPlaying] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const startTimeRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    },
    [],
  )

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mr = new MediaRecorder(stream)
      recorderRef.current = mr
      chunksRef.current = []
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: chunksRef.current[0]?.type || 'audio/webm',
        })
        const url = URL.createObjectURL(blob)
        if (recordingUrl) URL.revokeObjectURL(recordingUrl)
        setRecordingUrl(url)
        setRecordingDuration(
          Math.round((Date.now() - startTimeRef.current) / 1000),
        )
        setRecordingSaved(false)
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
      mr.start()
      startTimeRef.current = Date.now()
      setElapsed(0)
      setRecording(true)
      timerRef.current = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 250)
    } catch {
      toast('Microphone unavailable', {
        description: 'Grant mic access to record.',
      })
    }
  }

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive')
      recorderRef.current.stop()
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    setRecording(false)
  }

  const togglePlay = () => {
    const el = audioRef.current
    if (!el) return
    if (playing) el.pause()
    else void el.play()
  }

  const discard = () => {
    if (recordingUrl) URL.revokeObjectURL(recordingUrl)
    setRecordingUrl(null)
    setRecordingDuration(0)
    setRecordingSaved(false)
    setPlaying(false)
  }

  const saveRecording = () => {
    setRecordingSaved(true)
    toast('Recording saved')
  }

  return (
    <div className="space-y-6">
      <Intro
        title="What do you want to say?"
        body="Read the script below into your microphone. We'll play it for your recipients."
      />

      {!isCustom && (
        <FilterPillGroup
          type="single"
          value={tone}
          onValueChange={(v) => v && setTone(v as Tone)}
        >
          {TONES.map((t) => {
            const ToneIcon = TONE_ICONS[t]
            return (
              <FilterPill key={t} value={t} className="gap-1.5">
                <ToneIcon className="size-4" />
                {t}
              </FilterPill>
            )
          })}
        </FilterPillGroup>
      )}

      {/* Label + script grouped so the row sits nearer the field than the pills. */}
      <div className="space-y-3">
        {!isCustom && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">
              Suggested for {audience.name}
            </p>
            <Button
              variant="link"
              size="small"
              className="h-auto gap-1.5 px-0"
              disabled={loadingScript}
              onClick={onRegenerate}
            >
              {loadingScript ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Regenerate
            </Button>
          </div>
        )}

        <Card className="gap-2 p-4">
          <SectionLabel>Read this on your recording</SectionLabel>
          {isCustom ? (
            <Textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="Write your script…"
              className="min-h-[160px] resize-none border-0 p-0 focus-visible:ring-0 [field-sizing:content]"
            />
          ) : loadingScript && !script ? (
            <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
              <Loader2 className="size-4 animate-spin" /> Drafting script…
            </div>
          ) : (
            <p className="text-foreground text-base leading-relaxed whitespace-pre-wrap">
              {script}
            </p>
          )}
          <p className="text-muted-foreground text-base">
            {PAID_FOR_DISCLAIMER}
          </p>
        </Card>
      </div>
      <p className="text-muted-foreground text-xs">{ROBOCALL_LEGAL_NOTE}</p>

      {/* Record controls live in a bar pinned above the footer (source layout). */}
      {slotNode &&
        createPortal(
          <RecordBar
            recording={recording}
            elapsed={elapsed}
            recordingUrl={recordingUrl}
            recordingDuration={recordingDuration}
            recordingSaved={recordingSaved}
            playing={playing}
            onStart={startRecording}
            onStop={stopRecording}
            onTogglePlay={togglePlay}
            onSave={saveRecording}
            onDiscard={discard}
            audioRef={audioRef}
            setPlaying={setPlaying}
          />,
          slotNode,
        )}
    </div>
  )
}

// ---------- Record bar (pinned above the footer on the record step) ----------
const RecordBar = ({
  recording,
  elapsed,
  recordingUrl,
  recordingDuration,
  recordingSaved,
  playing,
  onStart,
  onStop,
  onTogglePlay,
  onSave,
  onDiscard,
  audioRef,
  setPlaying,
}: {
  recording: boolean
  elapsed: number
  recordingUrl: string | null
  recordingDuration: number
  recordingSaved: boolean
  playing: boolean
  onStart: () => void
  onStop: () => void
  onTogglePlay: () => void
  onSave: () => void
  onDiscard: () => void
  audioRef: React.RefObject<HTMLAudioElement | null>
  setPlaying: (v: boolean) => void
}) => (
  <div className="mx-auto flex w-full max-w-[608px] items-center gap-3">
    {recording ? (
      <>
        <IconButton
          variant="destructive"
          size="large"
          aria-label="Stop recording"
          onClick={onStop}
        >
          <Square className="size-5 fill-current" />
        </IconButton>
        <Waveform />
        <span className="text-foreground ml-auto text-sm font-medium tabular-nums">
          {fmtDuration(elapsed)}
        </span>
      </>
    ) : recordingUrl ? (
      <>
        <IconButton
          variant="default"
          size="large"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={onTogglePlay}
        >
          {playing ? (
            <Pause className="size-5 fill-current" />
          ) : (
            <Play className="size-5 fill-current" />
          )}
        </IconButton>
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate text-sm font-medium">
            {recordingSaved ? 'Recording saved' : 'Preview your recording'}
          </p>
          <p className="text-muted-foreground text-xs tabular-nums">
            {fmtDuration(recordingDuration)}
          </p>
        </div>
        {recordingSaved ? (
          <Button variant="ghost" size="small" onClick={onDiscard}>
            <Trash2 className="size-4" />
            Re-record
          </Button>
        ) : (
          <>
            <IconButton
              variant="ghost"
              size="small"
              aria-label="Discard"
              onClick={onDiscard}
            >
              <Trash2 className="size-4" />
            </IconButton>
            <Button
              size="small"
              onClick={onSave}
              disabled={recordingDuration < 2}
            >
              Save
            </Button>
          </>
        )}
        <audio
          ref={audioRef}
          src={recordingUrl}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          className="hidden"
        />
      </>
    ) : (
      <div className="flex w-full items-center justify-center">
        <IconButton
          variant="destructive"
          size="large"
          aria-label="Start recording"
          onClick={onStart}
        >
          <Mic className="size-6" />
        </IconButton>
      </div>
    )}
  </div>
)

// Animated bars shown while recording — pure decoration (no DS equivalent).
const Waveform = () => (
  <div className="flex flex-1 items-center gap-[3px]">
    {Array.from({ length: 24 }).map((_, i) => (
      <span
        key={i}
        className="bg-destructive/70 w-[3px] animate-pulse rounded-full"
        style={{
          height: `${8 + ((i * 37) % 20)}px`,
          animationDelay: `${(i % 8) * 90}ms`,
          animationDuration: '800ms',
        }}
      />
    ))}
  </div>
)

const Intro = ({ title, body }: { title: string; body: string }) => (
  <div className="space-y-2">
    <h3 className="text-foreground text-xl font-semibold">{title}</h3>
    <p className="text-muted-foreground text-base">{body}</p>
  </div>
)
