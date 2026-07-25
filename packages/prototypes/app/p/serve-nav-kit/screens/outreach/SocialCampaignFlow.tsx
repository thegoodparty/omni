'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, Copy, Loader2, RefreshCw, X } from 'lucide-react'
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
  Label,
  Stepper,
  Textarea,
  toast,
} from '@goodparty_org/styleguide'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import {
  type PlatformMeta,
  type SocialPlatform,
  type SocialPurposeId,
  type SocialTone,
  ALL_PLATFORMS,
  ALL_PLATFORM_IDS,
  SHARE_URL,
  SOCIAL_PURPOSES,
  TONES,
  TONE_ICONS,
  generateSocialAssets,
  generateSocialDraft,
  metaFor,
  socialPurposeLabel,
} from './socialData'

type SocialMode = 'copy' | 'script'

export type PublishedSocial = {
  name: string
  purpose: SocialPurposeId
  purposeLabel: string
  mode: SocialMode
  tone: SocialTone
  platforms: SocialPlatform[]
  assets: Record<string, { content: string; caption?: string }>
}

type StepId = 'purpose' | 'say' | 'where' | 'share'
const STEP_ORDER: StepId[] = ['purpose', 'say', 'where', 'share']

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  onPublished: (result: PublishedSocial) => void
}

export const SocialCampaignFlow = ({
  open,
  onOpenChange,
  onPublished,
}: Props) => {
  const [stepId, setStepId] = useState<StepId>('purpose')
  const [purpose, setPurpose] = useState<SocialPurposeId | null>(null)
  const [tone, setTone] = useState<SocialTone>('Warm')
  const [draft, setDraft] = useState('')
  const [draftLoading, setDraftLoading] = useState(false)
  const seedRef = useRef(0)
  const [platforms, setPlatforms] = useState<SocialPlatform[]>(ALL_PLATFORM_IDS)
  const [assets, setAssets] = useState<
    Record<string, { content: string; caption?: string }>
  >({})
  const [assetsLoading, setAssetsLoading] = useState(false)

  const stepIndex = STEP_ORDER.indexOf(stepId)
  const stepNumber = stepIndex + 1

  useEffect(() => {
    if (open) return
    const t = setTimeout(() => {
      setStepId('purpose')
      setPurpose(null)
      setTone('Warm')
      setDraft('')
      setDraftLoading(false)
      seedRef.current = 0
      setPlatforms(ALL_PLATFORM_IDS)
      setAssets({})
      setAssetsLoading(false)
    }, 200)
    return () => clearTimeout(t)
  }, [open])

  // Auto-draft on entering "say" (except the write-your-own purpose).
  useEffect(() => {
    if (stepId !== 'say' || draft.trim() || purpose === 'thank-you') return
    setDraftLoading(true)
    const t = setTimeout(() => {
      setDraft(generateSocialDraft(purpose ?? 'introduce', seedRef.current))
      setDraftLoading(false)
    }, 900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId])

  // Auto-generate per-platform assets on entering "share".
  useEffect(() => {
    if (stepId !== 'share' || Object.keys(assets).length > 0) return
    setAssetsLoading(true)
    const t = setTimeout(() => {
      setAssets(generateSocialAssets(draft, platforms))
      setAssetsLoading(false)
    }, 1100)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId])

  const regenerateDraft = () => {
    if (!purpose || purpose === 'thank-you') return
    seedRef.current += 1
    const seed = seedRef.current
    setAssets({})
    setDraftLoading(true)
    setTimeout(() => {
      setDraft(generateSocialDraft(purpose, seed))
      setDraftLoading(false)
    }, 900)
  }

  // Switching tone re-drafts the message; keep the user's own text on "thank-you".
  const handleToneChange = (t: SocialTone) => {
    setTone(t)
    setAssets({})
    if (purpose !== 'thank-you') regenerateDraft()
  }

  const canContinue = useMemo(() => {
    if (stepId === 'purpose') return purpose !== null
    if (stepId === 'say') return draft.trim().length > 0 && !draftLoading
    if (stepId === 'where') return platforms.length > 0
    return true
  }, [stepId, purpose, draft, draftLoading, platforms])

  const stepTitle =
    stepId === 'purpose'
      ? 'What do you want to do?'
      : stepId === 'say'
        ? 'What do you want to say?'
        : stepId === 'where'
          ? 'Where do you want to share it?'
          : 'Your assets are ready'

  const showBack = stepIndex > 0
  const showFooter = stepId !== 'purpose'

  const handleContinue = () => {
    const next = STEP_ORDER[stepIndex + 1]
    if (next) setStepId(next)
  }
  const handleBack = () => {
    const prev = STEP_ORDER[stepIndex - 1]
    if (prev) setStepId(prev)
  }

  const handleFinish = () => {
    if (!purpose) return
    const overallMode: SocialMode = platforms.every(
      (p) => metaFor(p).kind === 'script',
    )
      ? 'script'
      : 'copy'
    onPublished({
      name: socialPurposeLabel(purpose),
      purpose,
      purposeLabel: socialPurposeLabel(purpose),
      mode: overallMode,
      tone,
      platforms,
      assets,
    })
    onOpenChange(false)
  }

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
            <Stepper
              variant="bar"
              currentStep={stepNumber}
              totalSteps={STEP_ORDER.length}
              className="mt-2 lg:mt-3"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 lg:px-6">
          <div className="mx-auto w-full max-w-[608px]">
            {stepId === 'purpose' ? (
              <StepPurpose
                selected={purpose}
                onSelect={(id) => {
                  setPurpose(id)
                  setDraft('')
                  setAssets({})
                  setStepId('say')
                }}
              />
            ) : stepId === 'say' ? (
              <StepSay
                tone={tone}
                setTone={handleToneChange}
                draft={draft}
                setDraft={(v) => {
                  setDraft(v)
                  setAssets({})
                }}
                loading={draftLoading}
                onRegenerate={regenerateDraft}
                isCustom={purpose === 'thank-you'}
              />
            ) : stepId === 'where' ? (
              <StepWhere
                selected={platforms}
                onToggle={(id) => {
                  setAssets({})
                  setPlatforms((cur) =>
                    cur.includes(id)
                      ? cur.filter((p) => p !== id)
                      : [...cur, id],
                  )
                }}
              />
            ) : (
              <StepShare
                platforms={platforms}
                assets={assets}
                loading={assetsLoading}
              />
            )}
          </div>
        </div>

        {showFooter && (
          <div className="border-border bg-background shrink-0 border-t px-4 py-3 lg:px-6">
            <div className="mx-auto w-full max-w-[608px]">
              {stepId !== 'share' ? (
                <Button
                  className="w-full"
                  disabled={!canContinue}
                  onClick={handleContinue}
                >
                  Continue
                </Button>
              ) : (
                <Button
                  className="w-full"
                  disabled={assetsLoading || Object.keys(assets).length === 0}
                  onClick={handleFinish}
                >
                  Save
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
  selected: SocialPurposeId | null
  onSelect: (id: SocialPurposeId) => void
}) => (
  <div className="space-y-6">
    <Intro
      title="What do you want to do?"
      body="This helps us tailor your message and choose the right platforms."
    />
    <div className="space-y-3">
      {SOCIAL_PURPOSES.map((p) => {
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

// ---------- Step 2: Say ----------
const StepSay = ({
  tone,
  setTone,
  draft,
  setDraft,
  loading,
  onRegenerate,
  isCustom,
}: {
  tone: SocialTone
  setTone: (t: SocialTone) => void
  draft: string
  setDraft: (v: string) => void
  loading: boolean
  onRegenerate: () => void
  isCustom: boolean
}) => (
  <div className="space-y-6">
    <Intro
      title="What do you want to say?"
      body="Confirm the message. We'll adapt this draft to each platform's voice and length in the next steps."
    />

    <FilterPillGroup
      type="single"
      value={tone}
      onValueChange={(v) => v && setTone(v as SocialTone)}
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

    {/* Label + field grouped so the row sits nearer the field than the pills. */}
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">Your draft message</p>
        {!isCustom && (
          <Button
            variant="link"
            size="small"
            className="h-auto gap-1.5 px-0"
            disabled={loading}
            onClick={onRegenerate}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Regenerate
          </Button>
        )}
      </div>

      {loading && !draft.trim() ? (
        <ThinkingStream />
      ) : (
        <Card className="p-4 shadow-none">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write your message…"
            className="min-h-[140px] resize-none border-0 p-0 shadow-none focus-visible:ring-0 [field-sizing:content]"
          />
        </Card>
      )}
    </div>
  </div>
)

// ---------- Step 3: Where ----------
const StepWhere = ({
  selected,
  onToggle,
}: {
  selected: SocialPlatform[]
  onToggle: (id: SocialPlatform) => void
}) => (
  <div className="space-y-6">
    <Intro
      title="Where do you want to share it?"
      body="All platforms are on by default. Turn off any you don't want. We'll adapt your draft into post copy or a video script for each one."
    />

    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {ALL_PLATFORMS.map((p) => {
        const active = selected.includes(p.id)
        const Icon = p.icon
        return (
          <Card
            key={p.id}
            role="button"
            aria-pressed={active}
            tabIndex={0}
            onClick={() => onToggle(p.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onToggle(p.id)
              }
            }}
            className={cn(
              'relative items-center gap-2 rounded-2xl p-4 text-center shadow-none transition-colors',
              active ? 'border-primary bg-muted' : 'hover:border-primary/50',
            )}
          >
            {active && (
              <span className="bg-primary text-primary-foreground absolute top-2 right-2 flex size-5 items-center justify-center rounded-full">
                <Check className="size-3" />
              </span>
            )}
            <span className="bg-secondary-light text-foreground flex size-10 items-center justify-center rounded-full">
              <Icon className="size-5" />
            </span>
            <span className="text-foreground text-sm font-medium">
              {p.label}
            </span>
            <span className="text-muted-foreground text-xs">{p.helper}</span>
          </Card>
        )
      })}
    </div>
  </div>
)

// ---------- Step 4: Share ----------
const StepShare = ({
  platforms,
  assets,
  loading,
}: {
  platforms: SocialPlatform[]
  assets: Record<string, { content: string; caption?: string }>
  loading: boolean
}) => {
  const hasAssets = Object.keys(assets).length > 0
  return (
    <div className="space-y-6">
      <Intro
        title="Your assets are ready"
        body="Copy the post text or read the script on camera. Free to share — no ad spend required."
      />

      {loading && !hasAssets && <ThinkingStream />}

      <div className="space-y-4">
        {platforms.map((p) => {
          const meta = metaFor(p)
          const asset = assets[p]
          if (!asset) return null
          return meta.kind === 'script' ? (
            <ScriptCard key={p} meta={meta} asset={asset} />
          ) : (
            <CopyCard key={p} meta={meta} asset={asset} />
          )
        })}
      </div>
    </div>
  )
}

const PlatformChip = ({ meta }: { meta: PlatformMeta }) => {
  const Icon = meta.icon
  return (
    <span className="flex items-center gap-2">
      <span className="bg-secondary-light text-foreground flex size-7 items-center justify-center rounded-full">
        <Icon className="size-4" />
      </span>
      <span className="text-foreground text-sm font-semibold">
        {meta.label}
      </span>
    </span>
  )
}

const copyText = async (text: string, label: string) => {
  try {
    await navigator.clipboard.writeText(text)
    toast(label)
  } catch {
    toast('Copy failed')
  }
}

const CopyCard = ({
  meta,
  asset,
}: {
  meta: PlatformMeta
  asset: { content: string; caption?: string }
}) => {
  const postToX = () => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(asset.content)}&url=${encodeURIComponent(SHARE_URL)}`
    const win = window.open(url, '_blank', 'width=600,height=600')
    if (!win)
      toast('Popup blocked', {
        description: 'Allow popups for this site to post to X.',
      })
  }
  return (
    <Card className="gap-3 p-4 shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PlatformChip meta={meta} />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="small"
            variant="outline"
            onClick={() => copyText(asset.content, `Copied ${meta.label} post`)}
          >
            <Copy className="size-4" />
            Copy
          </Button>
          {meta.id === 'x' && (
            <Button size="small" variant="outline" onClick={postToX}>
              <X className="size-4" />
              Post
            </Button>
          )}
        </div>
      </div>
      <p className="text-foreground text-sm leading-6 whitespace-pre-wrap">
        {asset.content}
      </p>
    </Card>
  )
}

const ScriptCard = ({
  meta,
  asset,
}: {
  meta: PlatformMeta
  asset: { content: string; caption?: string }
}) => (
  <Card className="gap-4 p-4 shadow-none">
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2">
        <PlatformChip meta={meta} />
        <span className="text-muted-foreground text-xs">Read on camera</span>
      </span>
      <Button
        size="small"
        variant="outline"
        onClick={() => copyText(asset.content, `Copied ${meta.label} script`)}
      >
        <Copy className="size-4" />
        Copy
      </Button>
    </div>

    {/* Teleprompter-style script view */}
    <div className="bg-muted rounded-2xl p-5">
      <p className="text-foreground text-lg leading-8 font-medium whitespace-pre-wrap">
        {asset.content}
      </p>
    </div>

    {asset.caption && (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-muted-foreground text-xs font-semibold">
            Caption
          </Label>
          <Button
            size="small"
            variant="outline"
            onClick={() => copyText(asset.caption ?? '', 'Caption copied')}
          >
            <Copy className="size-4" />
            Copy caption
          </Button>
        </div>
        <p className="border-border bg-background text-foreground rounded-2xl border p-3 text-sm leading-6 whitespace-pre-wrap">
          {asset.caption}
        </p>
      </div>
    )}
  </Card>
)

const THINKING_MESSAGES = [
  'Examining your priorities…',
  'Reading community issues…',
  'Checking your campaign tone…',
  'Matching your message to each platform…',
  'Drafting content for each platform…',
]

const ThinkingStream = () => {
  const [index, setIndex] = useState(0)
  const [visibleText, setVisibleText] = useState('')

  useEffect(() => {
    const full = THINKING_MESSAGES[index] ?? ''
    let pos = 0
    setVisibleText('')
    const type = window.setInterval(() => {
      pos += 1
      setVisibleText(full.slice(0, pos))
      if (pos >= full.length) {
        window.clearInterval(type)
        window.setTimeout(
          () => setIndex((i) => (i + 1) % THINKING_MESSAGES.length),
          900,
        )
      }
    }, 45)
    return () => window.clearInterval(type)
  }, [index])

  return (
    <Card className="p-6 shadow-none">
      <div className="flex items-start gap-3">
        <span className="bg-primary-light relative flex size-8 shrink-0 items-center justify-center rounded-full">
          <Loader2 className="text-primary size-4 animate-spin" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-foreground text-sm font-medium">
            {visibleText}
            <span className="bg-primary ml-0.5 inline-block h-3.5 w-0.5 animate-pulse align-middle" />
          </span>
          <span className="text-muted-foreground text-xs">
            AI is drafting your message
          </span>
        </div>
      </div>
    </Card>
  )
}

const Intro = ({ title, body }: { title: string; body: string }) => (
  <div className="space-y-2">
    <h3 className="text-foreground text-xl font-semibold">{title}</h3>
    <p className="text-muted-foreground text-base">{body}</p>
  </div>
)
