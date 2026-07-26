'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import {
  Button,
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
  Stepper,
  Textarea,
  toast,
} from '@goodparty_org/styleguide'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import { SectionLabel } from '../../components/SectionLabel'
import { CHANNEL_ICON } from './data'
import {
  type Audience,
  type PhoneBankPurposeId,
  type Tone,
  AUDIENCES,
  DEFAULT_AUDIENCE,
  FILTER_POOLS,
  MAX_PDF_ROWS,
  PHONEBANK_PURPOSES,
  PHONEBANK_RECOMMENDATION,
  TONES,
  TONE_ICONS,
  estimateAudienceSize,
  generateScript,
} from './phoneBankData'

// Summary icon reuses the channel card's icon (single source of truth).
const PhoneBankIcon = CHANNEL_ICON['phone-bank']

export type ScheduledPhoneBank = {
  name: string
  audience: Audience
  script: string
}

type Step = 1 | 2 | 3 | 4 | 5

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  onScheduled: (result: ScheduledPhoneBank) => void
  onLaunch: () => void
}

export const PhoneBankCampaignFlow = ({
  open,
  onOpenChange,
  onScheduled,
  onLaunch,
}: Props) => {
  const [step, setStep] = useState<Step>(1)
  const [purpose, setPurpose] = useState<PhoneBankPurposeId | null>(null)

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

  const [campaignName, setCampaignName] = useState('')
  const [tone, setTone] = useState<Tone>('Warm')
  const [loadingScript, setLoadingScript] = useState(false)
  const seedRef = useRef(0)
  const [script, setScript] = useState('')

  const [listCount, setListCount] = useState(1)
  const [downloading, setDownloading] = useState(false)
  const [downloaded, setDownloaded] = useState(false)

  const selectedAudience = useMemo(
    () =>
      audiences.find((a) => a.id === selectedAudienceId) ?? DEFAULT_AUDIENCE,
    [audiences, selectedAudienceId],
  )

  const lastAutoName = useRef('')
  useEffect(() => {
    const def = `${selectedAudience.name} — Phone bank`
    if (campaignName === '' || campaignName === lastAutoName.current) {
      setCampaignName(def)
      lastAutoName.current = def
    }
  }, [selectedAudience, campaignName])

  // Script is drafted when the script step opens (source drafts on entry).
  useEffect(() => {
    if (step !== 3 || script) return
    if (purpose === 'custom') return
    setLoadingScript(true)
    const t = setTimeout(() => {
      setScript(generateScript(purpose ?? 'introduce', seedRef.current))
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
      setScript(generateScript(purpose, seed))
      setLoadingScript(false)
    }, 650)
  }

  // Switching tone clears the script; the user regenerates to redraft.
  const handleToneChange = (t: Tone) => {
    setTone(t)
    setScript('')
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
    setCampaignName('')
    setTone('Warm')
    seedRef.current = 0
    setScript('')
    setListCount(1)
    setDownloading(false)
    setDownloaded(false)
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
    if (step === 3) return script.trim().length > 0 && !loadingScript
    if (step === 4)
      return Number.isInteger(listCount) && listCount >= 1 && listCount <= 20
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
        id: `custom-${crypto.randomUUID()}`,
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

  const handleDownload = () => {
    setDownloading(true)
    setTimeout(() => {
      setDownloading(false)
      setDownloaded(true)
      toast.success(
        listCount > 1 ? 'Call lists downloaded' : 'Call list downloaded',
      )
    }, 900)
  }

  const handleFinish = () => {
    const displayName =
      campaignName.trim() || `${selectedAudience.name} — phone bank`
    onScheduled({
      name: displayName,
      audience: selectedAudience,
      script,
    })
    onLaunch()
    onOpenChange(false)
  }

  const stepTitle =
    step === 1
      ? 'What do you want to do?'
      : step === 2
        ? 'Who are you calling?'
        : step === 3
          ? 'What do you want to say?'
          : step === 4
            ? 'How many voters?'
            : 'Your call list is ready'

  const showBack = step > 1 || building
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
              <StepScript
                audience={selectedAudience}
                tone={tone}
                setTone={handleToneChange}
                loadingScript={loadingScript}
                onRegenerate={regenerate}
                isCustom={purpose === 'custom'}
                script={script}
                setScript={setScript}
                name={campaignName}
                setName={setCampaignName}
              />
            ) : step === 4 ? (
              <StepListCount value={listCount} onChange={setListCount} />
            ) : (
              <StepDownload
                audience={selectedAudience}
                script={script}
                listCount={listCount}
                downloading={downloading}
                downloaded={downloaded}
                onDownload={handleDownload}
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
                <Button className="w-full" onClick={handleFinish}>
                  Go to call list
                  <ArrowRight className="size-4" />
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
  selected: PhoneBankPurposeId | null
  onSelect: (id: PhoneBankPurposeId) => void
}) => (
  <div className="space-y-6">
    <Intro
      title="What do you want to do?"
      body="This helps us generate the best script for your volunteers to read."
    />
    <div className="space-y-3">
      {PHONEBANK_PURPOSES.map((p) => {
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
    (a) => a.id === PHONEBANK_RECOMMENDATION.audienceId,
  )
  const recSelected = selectedId === PHONEBANK_RECOMMENDATION.audienceId
  const hasFilters = builderFilters.length > 0

  if (building && naming) {
    return (
      <div className="space-y-6">
        <Intro title="Name your list" body="You can rename it any time." />
        <div className="space-y-2">
          <Label htmlFor="pb-list-name">List name</Label>
          <Input
            id="pb-list-name"
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
                {PHONEBANK_RECOMMENDATION.title}
              </p>
              <p className="text-muted-foreground truncate text-sm">
                Reach {PHONEBANK_RECOMMENDATION.reach.toLocaleString()} voters
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
                  Call {active.count.toLocaleString()} voters — free
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
                        Call {a.count.toLocaleString()} voters — free
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
        Phone banking is free — your volunteers do the calling.
      </p>
    </div>
  )
}

// ---------- Step 3: Script ----------
const StepScript = ({
  audience,
  tone,
  setTone,
  loadingScript,
  onRegenerate,
  isCustom,
  script,
  setScript,
  name,
  setName,
}: {
  audience: Audience
  tone: Tone
  setTone: (t: Tone) => void
  loadingScript: boolean
  onRegenerate: () => void
  isCustom: boolean
  script: string
  setScript: (v: string) => void
  name: string
  setName: (v: string) => void
}) => (
  <div className="space-y-6">
    <p className="text-muted-foreground text-base">
      This is the script your volunteers will read on the phone. Edit it to
      sound like you.
    </p>

    <div className="space-y-2">
      <Label htmlFor="pb-campaign-name">Campaign name</Label>
      <Input
        id="pb-campaign-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={`${audience.name} — phone bank`}
        maxLength={60}
      />
      <p className="text-muted-foreground text-sm">
        Internal name to identify this campaign in your history.
      </p>
    </div>

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
        <SectionLabel>Call script</SectionLabel>
        {loadingScript && !script ? (
          <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
            <Loader2 className="size-4 animate-spin" /> Drafting script…
          </div>
        ) : (
          <Textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder={
              isCustom ? 'Write your script…' : 'Your script will appear here…'
            }
            className="min-h-[240px] resize-none border-0 p-0 text-base leading-relaxed focus-visible:ring-0 [field-sizing:content]"
          />
        )}
      </Card>
    </div>
  </div>
)

// ---------- Step 4: List count ----------
const StepListCount = ({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) => (
  <div className="space-y-6">
    <Intro
      title="How many lists would you like me to create?"
      body="Creating multiple lists makes it simpler to share with volunteers, friends, and family."
    />
    <div className="space-y-2">
      <Label htmlFor="pb-list-count">Number of lists</Label>
      <Input
        id="pb-list-count"
        type="number"
        inputMode="numeric"
        min={1}
        max={20}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          if (Number.isNaN(n)) {
            onChange(1)
            return
          }
          onChange(Math.max(1, Math.min(20, n)))
        }}
      />
      <p className="text-muted-foreground text-sm">Between 1 and 20 lists.</p>
    </div>
  </div>
)

// ---------- Step 5: Download ----------
const StepDownload = ({
  audience,
  script,
  listCount,
  downloading,
  downloaded,
  onDownload,
}: {
  audience: Audience
  script: string
  listCount: number
  downloading: boolean
  downloaded: boolean
  onDownload: () => void
}) => {
  const isZip = listCount > 1
  const totalRows = Math.min(audience.count, MAX_PDF_ROWS * listCount)
  return (
    <div className="space-y-6">
      <Intro
        title={isZip ? 'Your call lists are ready' : 'Your call list is ready'}
        body={`Download the ${isZip ? 'PDFs' : 'PDF'} for your volunteers, then go to the calling page to start making calls and marking outcomes.`}
      />

      <Card className="gap-3 p-4 text-sm">
        <div className="flex items-center gap-3">
          <span className="bg-warning/10 flex size-12 shrink-0 items-center justify-center rounded-full">
            <PhoneBankIcon className="text-warning size-6" />
          </span>
          <div className="min-w-0">
            <p className="text-foreground font-medium">
              {isZip
                ? `${listCount} phone banking call sheets`
                : 'Phone banking call sheet'}
            </p>
            <p className="text-muted-foreground text-sm">
              {audience.name} · {totalRows.toLocaleString()} contacts
              {isZip ? ` split across ${listCount} lists` : ''}
            </p>
          </div>
        </div>
        <div className="border-border text-muted-foreground border-t pt-3 text-sm">
          <p>{isZip ? 'Each PDF includes:' : 'The PDF includes:'}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Your call script</li>
            <li>Contacts with name, phone, and status checkboxes</li>
            <li>
              Statuses: Answered, No answer, Voicemail left, Wrong number,
              Refused
            </li>
            <li>Support (Y / U / N) and notes column</li>
          </ul>
        </div>
      </Card>

      <Button
        variant="outline"
        className="w-full"
        onClick={onDownload}
        disabled={downloading || !script.trim()}
      >
        {downloading ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {isZip ? 'Generating ZIP…' : 'Generating PDF…'}
          </>
        ) : downloaded ? (
          <>
            <Check className="size-4" /> Downloaded — download again
          </>
        ) : (
          <>
            <Download className="size-4" />
            {isZip
              ? `Download ${listCount} call sheets (ZIP)`
              : 'Download call sheet (PDF)'}
          </>
        )}
      </Button>
    </div>
  )
}

const Intro = ({ title, body }: { title: string; body: string }) => (
  <div className="space-y-2">
    <h3 className="text-foreground text-xl font-semibold">{title}</h3>
    <p className="text-muted-foreground text-base">{body}</p>
  </div>
)
