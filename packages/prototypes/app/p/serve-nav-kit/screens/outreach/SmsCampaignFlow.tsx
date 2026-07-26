'use client'

import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  AlertCircle,
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  ImageIcon,
  Loader2,
  Mic,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  X,
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
import { useSpeechDictation } from './useSpeechDictation'
import {
  type Audience,
  type PurposeId,
  type Tone,
  AUDIENCES,
  COST_PER_RECIPIENT,
  DEFAULT_AUDIENCE,
  FILTER_POOLS,
  OPT_OUT_FOOTER,
  PURPOSES,
  SMS_CHAR_LIMIT,
  SMS_RECOMMENDATION,
  TIME_OPTIONS,
  TONE_ICONS,
  TONES,
  estimateAudienceSize,
  formatMoney,
  generateDraft,
  hasIntro,
  introFor,
  messageEndsWithOptOut,
} from './smsData'

// Review header reuses the channel card's icon + tint (single source of truth).
const SmsChannelIcon = CHANNEL_ICON.sms

export type ScheduledSms = {
  name: string
  audience: Audience
  sendAt: Date
  message: string
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

// Renders {merge_var} tokens as inline pills — light-blue tint that stays readable
// on both the light editor card and the dark (bg-primary) preview bubble.
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
  onScheduled: (result: ScheduledSms) => void
}

export const SmsCampaignFlow = ({ open, onOpenChange, onScheduled }: Props) => {
  const [step, setStep] = useState<Step>(1)
  const [purpose, setPurpose] = useState<PurposeId | null>(null)

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

  const [tone, setTone] = useState<Tone>('Warm')
  const [loadingDrafts, setLoadingDrafts] = useState(false)
  const seedRef = useRef(0)
  const [message, setMessage] = useState('')
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [success, setSuccess] = useState(false)

  const selectedAudience = useMemo(
    () =>
      audiences.find((a) => a.id === selectedAudienceId) ?? DEFAULT_AUDIENCE,
    [audiences, selectedAudienceId],
  )
  const cost = selectedAudience.count * COST_PER_RECIPIENT

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

  // Auto-name the campaign from the audience + date.
  const lastAutoName = useRef('')
  useEffect(() => {
    const def = `${selectedAudience.name} — SMS${date ? `, ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`
    if (campaignName === '' || campaignName === lastAutoName.current) {
      setCampaignName(def)
      lastAutoName.current = def
    }
  }, [selectedAudience, date, campaignName])

  // Draft a message on entering step 4 (custom purpose just seeds the intro).
  useEffect(() => {
    if (step !== 4 || message.trim()) return
    if (purpose === 'custom') {
      setMessage(introFor(tone) + ' ')
      return
    }
    setLoadingDrafts(true)
    const t = setTimeout(() => {
      setMessage(generateDraft(purpose ?? 'introduce', tone, seedRef.current))
      setLoadingDrafts(false)
    }, 650)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const regenerate = (toneArg: Tone = tone) => {
    if (!purpose || purpose === 'custom') return
    seedRef.current += 1
    const seed = seedRef.current
    setLoadingDrafts(true)
    setTimeout(() => {
      setMessage(generateDraft(purpose, toneArg, seed))
      setLoadingDrafts(false)
    }, 650)
  }

  // Switching tone re-drafts the message in the new voice.
  const handleToneChange = (t: Tone) => {
    setTone(t)
    if (purpose !== 'custom') regenerate(t)
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
    setMessage('')
    setMediaUrl(null)
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
    if (step === 4)
      return (
        message.trim().length > 0 &&
        message.length <= SMS_CHAR_LIMIT &&
        hasIntro(message)
      )
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
        message,
        cost,
      })
    }, 900)
  }

  const stepTitle = success
    ? 'Done'
    : step === 1
      ? 'What do you want to do?'
      : step === 2
        ? 'Who are you texting?'
        : step === 3
          ? 'When do you want to send?'
          : step === 4
            ? 'What do you want to say?'
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

        {/* Header. Close is provided by DrawerContent (built-in, top-right). Back
            sits above the title on mobile and to the left of the content column on
            desktop — matching the source OutreachDrawerHeader layout. */}
        <div className="border-border shrink-0 border-b px-4 py-3 lg:px-6 lg:py-4">
          <div className="mx-auto w-full max-w-[608px]">
            {/* Title row. Mobile: back inline via a fixed slot (title never shifts
                between steps). Desktop: back floats to the left of the column,
                vertically centered with the title. */}
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-5 lg:px-6">
          <div className="mx-auto w-full max-w-[608px]">
            {success ? (
              <SuccessScreen
                audience={selectedAudience}
                sendAt={scheduledAt}
                onClose={() => onOpenChange(false)}
              />
            ) : step === 1 ? (
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
              <StepWhat
                audience={selectedAudience}
                tone={tone}
                setTone={handleToneChange}
                loadingDrafts={loadingDrafts}
                onRegenerate={() => regenerate()}
                message={message}
                setMessage={setMessage}
                mediaUrl={mediaUrl}
                setMediaUrl={setMediaUrl}
              />
            ) : (
              <StepReview
                audience={selectedAudience}
                scheduledAt={scheduledAt}
                message={message}
                mediaUrl={mediaUrl}
                cost={cost}
              />
            )}
          </div>
        </div>

        {/* Footer */}
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

// ---------- Step 1: Purpose ----------
const StepPurpose = ({
  selected,
  onSelect,
}: {
  selected: PurposeId | null
  onSelect: (id: PurposeId) => void
}) => (
  <div className="space-y-6">
    <Intro
      title="What do you want to do?"
      body="This helps us generate the best message for your campaign."
    />
    <div className="space-y-3">
      {PURPOSES.map((p) => {
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

  if (building && naming) {
    return (
      <div className="space-y-6">
        <Intro title="Name your list" body="You can rename it any time." />
        <div className="space-y-2">
          <Label htmlFor="sms-list-name">List name</Label>
          <Input
            id="sms-list-name"
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

  const recommended = audiences.find(
    (a) => a.id === SMS_RECOMMENDATION.audienceId,
  )
  const recSelected = selectedId === SMS_RECOMMENDATION.audienceId

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
                {SMS_RECOMMENDATION.title}
              </p>
              <p className="text-muted-foreground truncate text-sm">
                Reach {SMS_RECOMMENDATION.reach.toLocaleString()} voters
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
                  Message {active.count.toLocaleString()} voters for $
                  {formatMoney(active.count * COST_PER_RECIPIENT)}
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
                        Message {a.count.toLocaleString()} voters for $
                        {formatMoney(a.count * COST_PER_RECIPIENT)}
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
        Each message costs ${COST_PER_RECIPIENT.toFixed(3)}
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
        <Label htmlFor="sms-name">Campaign name</Label>
        <Input
          id="sms-name"
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
                  // Match the DS Input / Select field styling (border, bg, and the
                  // text-base md:text-sm size) so all three fields look alike — the
                  // outline Button otherwise renders larger text-base.
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

// ---------- Step 4: What ----------
const polishMessage = (t: string): string => {
  const clean = t.replace(/\s+/g, ' ').trim()
  return /[.!?]$/.test(clean) ? clean : `${clean}.`
}

const StepWhat = ({
  audience,
  tone,
  setTone,
  loadingDrafts,
  onRegenerate,
  message,
  setMessage,
  mediaUrl,
  setMediaUrl,
}: {
  audience: Audience
  tone: Tone
  setTone: (t: Tone) => void
  loadingDrafts: boolean
  onRegenerate: () => void
  message: string
  setMessage: Dispatch<SetStateAction<string>>
  mediaUrl: string | null
  setMediaUrl: (v: string | null) => void
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [undoText, setUndoText] = useState<string | null>(null)
  const [polishing, setPolishing] = useState(false)
  const segments = Math.max(1, Math.ceil(message.length / 160))
  const overLimit = message.length > SMS_CHAR_LIMIT

  const { recording, supported, start, stop } = useSpeechDictation({
    onFinal: (chunk) => setMessage((m) => (m ? `${m.trimEnd()} ` : '') + chunk),
  })

  const handleFile = (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('Only image files can be attached.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast('Image too large', {
        description: 'Please choose an image under 5 MB.',
      })
      return
    }
    const reader = new FileReader()
    reader.onload = () =>
      setMediaUrl(typeof reader.result === 'string' ? reader.result : null)
    reader.readAsDataURL(file)
  }

  const handlePolish = () => {
    if (!message.trim()) return
    setUndoText(message)
    setPolishing(true)
    setTimeout(() => {
      setMessage((m) => polishMessage(m))
      setPolishing(false)
    }, 700)
  }

  const handleDictate = () => {
    if (recording) stop()
    else if (supported) start()
    else toast("Voice input isn't supported in this browser.")
  }

  return (
    <div className="space-y-6">
      <Intro
        title="What do you want to say?"
        body="Start from a draft, dictate your own, or improve with AI."
      />

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
      {/* Label + editor grouped so the row sits nearer the field than the pills. */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            Suggested for {audience.name}
          </p>
          <Button
            variant="link"
            size="small"
            className="h-auto gap-1.5 px-0"
            disabled={loadingDrafts}
            onClick={onRegenerate}
          >
            {loadingDrafts ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Regenerate
          </Button>
        </div>

        {/* Editor card: image, greeting, message, opt-out, toolbar. */}
        <Card className="gap-0 p-4 shadow-none">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              handleFile(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
          {mediaUrl ? (
            <div className="relative mb-4">
              <img
                src={mediaUrl}
                alt="Attachment preview"
                className="border-border max-h-56 w-full rounded-xl border object-cover"
              />
              <button
                type="button"
                onClick={() => setMediaUrl(null)}
                aria-label="Remove image"
                className="bg-foreground/80 text-background hover:bg-foreground absolute top-2 right-2 flex size-7 items-center justify-center rounded-full"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="border-border hover:border-primary/50 hover:bg-muted mb-4 flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed py-10 transition-colors"
            >
              <ImageIcon className="text-muted-foreground size-6" />
              <span className="text-foreground text-sm font-medium">
                Add your campaign headshot or logo
              </span>
              <span className="text-muted-foreground text-xs">
                Recipients see this in the message preview
              </span>
            </button>
          )}

          <div className="mb-2 flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-medium">
              Your message
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
            placeholder="Write your message…"
            aria-invalid={overLimit}
            className="min-h-[140px] resize-none border-0 p-0 shadow-none focus-visible:ring-0"
          />
          <p className="text-muted-foreground mt-3 text-xs">{OPT_OUT_FOOTER}</p>

          <div className="border-border -mx-4 -mb-4 mt-4 flex items-center justify-end gap-1 border-t p-2">
            {undoText !== null && (
              <Button
                variant="link"
                size="small"
                className="h-auto px-2"
                onClick={() => {
                  setMessage(undoText)
                  setUndoText(null)
                }}
              >
                Undo
              </Button>
            )}
            <Button
              variant="ghost"
              size="small"
              className="text-muted-foreground"
              onClick={handlePolish}
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
            <IconButton
              variant={recording ? 'destructive' : 'ghost'}
              size="small"
              className={cn(!recording && 'text-muted-foreground')}
              onClick={handleDictate}
              aria-label={recording ? 'Stop dictation' : 'Dictate'}
            >
              {recording ? (
                <Square className="size-4 fill-current" />
              ) : (
                <Mic className="size-5" />
              )}
            </IconButton>
          </div>
        </Card>
      </div>

      {message.trim().length > 0 && !hasIntro(message) && (
        <p className="text-destructive text-xs">
          Compliance: messages must open with an identification, e.g. “
          {introFor(tone)}”
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
  mediaUrl,
  cost,
}: {
  audience: Audience
  scheduledAt: Date | null
  message: string
  mediaUrl: string | null
  cost: number
}) => {
  const [preview, setPreview] = useState(false)
  return (
    <div className="space-y-6">
      <Intro
        title="Review & pay"
        body="Review your campaign details and complete your payment."
      />

      <Card className="gap-0 overflow-hidden p-0 shadow-none">
        <Accordion type="single" collapsible defaultValue="details">
          <AccordionItem value="details" className="border-none">
            <AccordionTrigger className="px-4 py-4 hover:no-underline">
              <div className="flex items-center gap-3 text-left">
                <span
                  className={cn(
                    'flex size-12 shrink-0 items-center justify-center rounded-full',
                    CHANNEL_ICON_TINT.sms,
                  )}
                >
                  <SmsChannelIcon className="text-foreground size-6" />
                </span>
                <div>
                  <p className="text-foreground font-medium">Text message</p>
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
                  <dt className="text-foreground">Price per message</dt>
                  <dd className="text-foreground">
                    ${COST_PER_RECIPIENT.toFixed(3)}
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
        {preview ? 'Hide preview' : 'Preview message'}
      </Button>

      {preview && (
        <div className="flex justify-center">
          <div className="bg-primary text-primary-foreground w-full max-w-[280px] rounded-2xl rounded-bl-sm p-3 text-sm">
            {mediaUrl && (
              <img
                src={mediaUrl}
                alt="Attached"
                className="mb-2 max-h-48 w-full rounded-xl object-cover"
              />
            )}
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
          This is a prototype — no real payment is taken.
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
        Payment successful!
      </h2>
      <p className="text-muted-foreground">
        Your text campaign has been scheduled and will reach{' '}
        {audience.count.toLocaleString()} recipients
        {sendAt ? ` on ${fmtDate(sendAt)}.` : ' shortly.'}
      </p>
    </div>
    <Button size="large" className="w-full" onClick={onClose}>
      Done
    </Button>
  </div>
)

// Shared step intro (title + body).
const Intro = ({ title, body }: { title: string; body: string }) => (
  <div className="space-y-2">
    <h3 className="text-foreground text-xl font-semibold">{title}</h3>
    <p className="text-muted-foreground text-base">{body}</p>
  </div>
)
