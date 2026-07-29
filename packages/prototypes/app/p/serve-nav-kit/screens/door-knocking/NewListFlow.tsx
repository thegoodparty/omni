'use client'

import { useMemo, useState } from 'react'
import {
  Button,
  Card,
  Drawer,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  IconButton,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stepper,
  cn,
  toast,
} from '@goodparty_org/styleguide'
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Sparkles,
  Users,
} from 'lucide-react'
import { FilterFields } from './FilterFields'
import { MapCanvas } from './MapCanvas'
import { Legend } from './Legend'
import {
  type CutFilters,
  type List,
  type ListColor,
  ALL_CONTACTS_ID,
  ALL_VOTERS,
  CUSTOM_VOTER_LISTS,
  DEFAULT_FILTERS,
  DEFAULT_LIST_COLOR,
  LIST_COLOR_TOKEN,
  LIST_COLOR_OPTIONS,
  MAX_LIST_HOUSEHOLDS,
  buildRoute,
  getHouseholdCount,
  hasActiveFilters,
  matchesFilters,
  universeFor,
  votersInPolygon,
} from './doorKnockingData'

// Step 1 of the create-list flow: goal picker, mirroring the phone bank flow.
const DOOR_PURPOSES: ReadonlyArray<{
  id: string
  label: string
  description: string
}> = [
  {
    id: 'issue',
    label: 'Discover local issues',
    description: 'Hear what neighbors care about most.',
  },
  {
    id: 'introduce',
    label: 'Introduce myself',
    description: 'Meet voters who do not know you yet.',
  },
  {
    id: 'persuade',
    label: 'Persuade undecided voters',
    description: 'Talk with voters who could still swing your way.',
  },
  {
    id: 'turnout',
    label: 'Turn out my supporters',
    description: 'Remind likely supporters to vote.',
  },
  {
    id: 'event',
    label: 'Invite people to an event',
    description: 'Promote a town hall or meet and greet.',
  },
  {
    id: 'custom',
    label: 'Something else',
    description: 'Build a list from scratch with your own filters.',
  },
]

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreate: (list: List) => void
  // Recommended lists surfaced inside the "who" step; picking one seeds its
  // pre-drawn area and jumps to the review (draw) step.
  recommendations?: List[]
  onRecommendationApplied?: (id: string) => void
}

type Step = 'purpose' | 'who' | 'name' | 'draw' | 'confirm'

let listSeq = 0

export const NewListFlow = ({
  open,
  onOpenChange,
  onCreate,
  recommendations = [],
  onRecommendationApplied,
}: Props) => {
  const [step, setStep] = useState<Step>('purpose')
  const [purposeId, setPurposeId] = useState<string | null>(null)
  const [recId, setRecId] = useState<string | null>(null)
  const [customListId, setCustomListId] = useState<string>(ALL_CONTACTS_ID)
  const [filters, setFilters] = useState<CutFilters>(DEFAULT_FILTERS)
  const [savedName, setSavedName] = useState('')
  const [savedFilterFlow, setSavedFilterFlow] = useState(false)
  const [polygon, setPolygon] = useState<{ x: number; y: number }[]>([])
  const [routeName, setRouteName] = useState('')
  const [color, setColor] = useState<ListColor>(DEFAULT_LIST_COLOR)
  // Set when a recommendation is chosen: the draw step becomes a pre-seeded
  // review of that list's area (its own header + copy).
  const [recMode, setRecMode] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [presetReason, setPresetReason] = useState('')

  const filteredUniverse = useMemo(() => {
    const base = universeFor(customListId)
    return base.filter((v) => matchesFilters(v, filters))
  }, [customListId, filters])

  const selected = useMemo(
    () =>
      polygon.length > 2 ? votersInPolygon(filteredUniverse, polygon) : [],
    [filteredUniverse, polygon],
  )

  const active = hasActiveFilters(filters)
  const needsName = customListId === ALL_CONTACTS_ID && active

  const reset = () => {
    setStep('purpose')
    setPurposeId(null)
    setRecId(null)
    setCustomListId(ALL_CONTACTS_ID)
    setFilters(DEFAULT_FILTERS)
    setSavedName('')
    setSavedFilterFlow(false)
    setPolygon([])
    setRouteName('')
    setColor(DEFAULT_LIST_COLOR)
    setRecMode(false)
    setPresetName('')
    setPresetReason('')
  }

  const close = () => {
    reset()
    onOpenChange(false)
  }

  const totalSteps =
    step === 'purpose'
      ? 4
      : step === 'who'
        ? needsName
          ? 5
          : 4
        : recMode
          ? 4
          : savedFilterFlow
            ? 5
            : 4
  const currentStep =
    step === 'purpose'
      ? 1
      : step === 'who'
        ? 2
        : step === 'name'
          ? 3
          : step === 'draw'
            ? recMode
              ? 3
              : savedFilterFlow
                ? 4
                : 3
            : recMode
              ? 4
              : savedFilterFlow
                ? 5
                : 4

  const showBack = step !== 'purpose'

  const header = (() => {
    if (step === 'purpose')
      return {
        title: 'What do you want to do?',
        description:
          'Pick a goal so we can shape the right door knocking list.',
      }
    if (step === 'who')
      return {
        title: 'Who do you want to reach?',
        description: 'Pick a recommended route or filter your own list.',
      }
    if (step === 'name')
      return {
        title: 'Name your list',
        description:
          'Save these filters as a reusable voter list before you draw.',
      }
    if (step === 'confirm')
      return {
        title: 'Confirm your list',
        description:
          'Review the route, give it a name and color, then save it to your team.',
      }
    // draw
    return recMode
      ? {
          title: presetName || 'Recommended list',
          description:
            presetReason ||
            'Recommended for you based on your profile and voters. Filters are pre-applied.',
        }
      : {
          title: 'Draw your door knocking boundaries',
          description: 'Outline map areas to build targeted door lists.',
        }
  })()

  const back = () => {
    if (step === 'confirm') setStep('draw')
    else if (step === 'draw')
      setStep(recMode ? 'who' : savedFilterFlow ? 'name' : 'who')
    else if (step === 'name') setStep('who')
    else if (step === 'who') setStep('purpose')
  }

  const applyRecommendation = (rec: List) => {
    setRecMode(true)
    setPresetName(rec.name)
    setPresetReason(rec.reason ?? '')
    setCustomListId(ALL_CONTACTS_ID)
    setFilters(rec.filters ?? DEFAULT_FILTERS)
    setSavedFilterFlow(false)
    setPolygon(rec.polygon)
    setColor(DEFAULT_LIST_COLOR)
    setRouteName(rec.name)
    setRecId(null)
    onRecommendationApplied?.(rec.id)
    setStep('draw')
  }

  const save = (stay: boolean) => {
    if (selected.length === 0) return
    const route = buildRoute(selected)
    listSeq += 1
    const name =
      routeName.trim() || savedName.trim() || `Door knocking list (${listSeq})`
    onCreate({
      id: `list-${listSeq}-${customListId}`,
      name,
      voterIds: route.map((v) => v.id),
      polygon,
      createdAt: '2026-07-25',
      color,
      filters: active ? filters : null,
      customListId: customListId === ALL_CONTACTS_ID ? null : customListId,
    })
    if (stay) {
      setPolygon([])
      setRouteName('')
      setStep('draw')
    } else {
      close()
    }
  }

  const confirmRoute = useMemo(() => buildRoute(selected), [selected])

  return (
    <Drawer
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DrawerContent className="flex h-[calc(100dvh-4rem)] flex-col p-0 data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-4rem)] lg:h-[calc(100dvh-8rem)] lg:data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-8rem)]">
        <DrawerHandle />
        <DrawerHeader className="sr-only">
          <DrawerTitle>{header.title}</DrawerTitle>
        </DrawerHeader>

        <div className="border-border shrink-0 border-b px-4 py-3 lg:px-6 lg:py-4">
          <div className="mx-auto w-full max-w-[608px]">
            {/* Title row — matches the SMS/Email flow drawers: back floats left of
                the column on desktop, inline in a fixed slot on mobile. */}
            <div className="relative flex items-center gap-2 lg:block">
              {showBack && (
                <div className="absolute top-1/2 right-full mr-9 hidden -translate-y-1/2 lg:block">
                  <Button variant="outline" size="small" onClick={back}>
                    <ArrowLeft className="size-4" />
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
                    onClick={back}
                  >
                    <ArrowLeft className="size-4" />
                  </IconButton>
                )}
              </div>
              <h2 className="text-foreground min-w-0 flex-1 truncate pr-8 text-base font-semibold lg:pr-0">
                {header.title}
              </h2>
            </div>
            {header.description && (
              <p className="text-muted-foreground mt-1 text-sm">
                {header.description}
              </p>
            )}
            <Stepper
              variant="bar"
              currentStep={currentStep}
              totalSteps={totalSteps}
              className="mt-2 lg:mt-3"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 lg:px-6">
          <div className="mx-auto w-full max-w-[608px]">
            {step === 'purpose' && (
              <div className="space-y-3">
                {DOOR_PURPOSES.map((p) => {
                  const on = purposeId === p.id
                  return (
                    <Card
                      key={p.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setPurposeId(p.id)
                        setStep('who')
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setPurposeId(p.id)
                          setStep('who')
                        }
                      }}
                      className={cn(
                        'flex-row items-center justify-between gap-3 rounded-lg p-4 transition-colors',
                        on ? 'border-primary' : 'hover:border-primary/50',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="text-foreground block truncate font-medium">
                          {p.label}
                        </span>
                        <span className="text-muted-foreground block truncate text-sm">
                          {p.description}
                        </span>
                      </span>
                      <ChevronRight className="text-muted-foreground size-5 shrink-0" />
                    </Card>
                  )
                })}
              </div>
            )}

            {step === 'who' && (
              <div className="space-y-6">
                {recommendations.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-foreground flex items-center gap-1.5 text-sm font-semibold">
                      <Sparkles
                        className="text-primary size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      Recommended lists
                    </h3>
                    <div className="space-y-2">
                      {recommendations.map((rec) => {
                        const on = recId === rec.id
                        return (
                          <Card
                            key={rec.id}
                            role="button"
                            tabIndex={0}
                            aria-pressed={on}
                            onClick={() => setRecId(on ? null : rec.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                setRecId(on ? null : rec.id)
                              }
                            }}
                            className={cn(
                              'flex-row items-center gap-3 p-4 transition-colors',
                              on ? 'border-primary' : 'hover:border-primary/50',
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-foreground truncate font-medium">
                                {rec.name}
                              </p>
                              <p className="text-muted-foreground truncate text-sm">
                                {rec.voterIds.length.toLocaleString()} doors
                              </p>
                            </div>
                            {on && (
                              <Check
                                className="text-primary size-5 shrink-0"
                                aria-hidden="true"
                              />
                            )}
                          </Card>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="custom-voter-list">Custom voter list</Label>
                  <Select
                    value={customListId}
                    onValueChange={(next) => {
                      setRecId(null)
                      setCustomListId(next)
                    }}
                  >
                    <SelectTrigger id="custom-voter-list" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_CONTACTS_ID}>
                        <span className="flex-1">All Contacts</span>
                        <span className="text-muted-foreground text-xs">
                          {ALL_VOTERS.length.toLocaleString()}
                        </span>
                      </SelectItem>
                      {CUSTOM_VOTER_LISTS.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="flex-1">{c.label}</span>
                          <span className="text-muted-foreground text-xs">
                            {ALL_VOTERS.filter(
                              c.predicate,
                            ).length.toLocaleString()}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <FilterFields
                  filters={filters}
                  setFilters={(next) => {
                    setRecId(null)
                    setFilters(next)
                  }}
                  universe={universeFor(customListId)}
                />
              </div>
            )}

            {step === 'name' && (
              <div className="space-y-4">
                <p className="text-muted-foreground text-sm">
                  Save this filter combination as a reusable voter list so you
                  can target the same audience again later.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="saved-list-name">List name</Label>
                  <Input
                    id="saved-list-name"
                    autoFocus
                    value={savedName}
                    onChange={(e) => setSavedName(e.target.value)}
                    placeholder="e.g. Homeowners in Precinct 2"
                    maxLength={50}
                  />
                </div>
                <p className="text-muted-foreground text-xs">
                  {filteredUniverse.length.toLocaleString()} voters match your
                  current filters.
                </p>
              </div>
            )}

            {step === 'draw' && (
              <div className="space-y-3">
                {recMode && (
                  <p className="text-muted-foreground text-sm">
                    We’ve already outlined the doors to knock for you. Drag any
                    boundary point to adjust the area, or tap on the map to add
                    more points around the doors you want to knock.
                  </p>
                )}
                <p className="text-sm">
                  <span className="text-foreground font-semibold">
                    {filteredUniverse.length.toLocaleString()}
                  </span>{' '}
                  <span className="text-muted-foreground">
                    matching households
                  </span>{' '}
                  ·{' '}
                  <span className="text-foreground font-semibold">
                    {selected.length.toLocaleString()}
                  </span>{' '}
                  <span className="text-muted-foreground">
                    selected households
                  </span>
                </p>
                <MapCanvas
                  mode="draw"
                  voters={filteredUniverse}
                  activePolygon={polygon}
                  onPolygonChange={setPolygon}
                  className="border-border h-64 rounded-xl border lg:h-80"
                />
                <Legend readOnly voters={filteredUniverse} />
              </div>
            )}

            {step === 'confirm' && (
              <div className="space-y-5">
                <MapCanvas
                  voters={selected}
                  activePolygon={polygon}
                  activeColor={LIST_COLOR_TOKEN[color]}
                  className="border-border h-48 rounded-xl border"
                />
                <div className="space-y-2">
                  <Label htmlFor="route-name">Route name</Label>
                  <Input
                    id="route-name"
                    autoFocus
                    value={routeName}
                    onChange={(e) => setRouteName(e.target.value)}
                    placeholder="Name this list"
                    maxLength={60}
                  />
                </div>
                <div className="space-y-2">
                  <Label>List color</Label>
                  <div className="flex flex-wrap gap-2">
                    {LIST_COLOR_OPTIONS.map((opt) => {
                      const on = color === opt.id
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          aria-label={opt.label}
                          aria-pressed={on}
                          onClick={() => setColor(opt.id)}
                          className={cn(
                            'flex size-8 items-center justify-center rounded-full border-2 transition-transform',
                            on
                              ? 'border-foreground scale-110'
                              : 'border-transparent hover:scale-105',
                          )}
                          style={{ backgroundColor: opt.token }}
                        >
                          {on && (
                            <CheckCircle2 className="size-4 text-white drop-shadow" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline justify-between">
                    <p className="text-foreground text-sm font-semibold">
                      Stops
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {confirmRoute.length} doors
                    </p>
                  </div>
                  <ol className="divide-border border-border mt-2 divide-y overflow-hidden rounded-xl border">
                    {confirmRoute.map((v, i) => (
                      <li key={v.id} className="flex items-center gap-3 p-3">
                        <span className="bg-muted text-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-foreground truncate text-sm font-medium">
                            {v.name}
                          </p>
                          <p className="text-muted-foreground truncate text-xs">
                            {v.address}
                          </p>
                        </div>
                        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                          <Users className="size-3.5" />
                          {getHouseholdCount(v)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="border-border bg-background shrink-0 border-t px-4 py-3 lg:px-6">
          <div className="mx-auto w-full max-w-[608px]">
            {step === 'who' && (
              <Button
                className="w-full"
                disabled={!recId && filteredUniverse.length === 0}
                onClick={() => {
                  if (recId) {
                    const rec = recommendations.find((r) => r.id === recId)
                    if (rec) {
                      applyRecommendation(rec)
                      return
                    }
                  }
                  // Custom path — clear any leftover recommendation seed so the
                  // draw step shows the from-scratch framing, not a stale one.
                  setRecMode(false)
                  setPresetName('')
                  setPresetReason('')
                  setPolygon([])
                  setRouteName('')
                  if (needsName) {
                    setStep('name')
                    return
                  }
                  setSavedFilterFlow(false)
                  setStep('draw')
                }}
              >
                Continue
              </Button>
            )}
            {step === 'name' && (
              <Button
                className="w-full"
                disabled={!savedName.trim()}
                onClick={() => {
                  setSavedFilterFlow(true)
                  setStep('draw')
                }}
              >
                Save and continue
              </Button>
            )}
            {step === 'draw' && (
              <Button
                className="w-full"
                disabled={selected.length === 0}
                onClick={() => {
                  if (selected.length > MAX_LIST_HOUSEHOLDS) {
                    toast.warning(
                      `Keep your list under ${MAX_LIST_HOUSEHOLDS.toLocaleString()} doors. You can create as many lists as you need.`,
                    )
                    return
                  }
                  if (!routeName.trim())
                    setRouteName(
                      savedName.trim() || `Door knocking list (${listSeq + 1})`,
                    )
                  setStep('confirm')
                }}
              >
                Add to saved lists ({selected.length.toLocaleString()})
              </Button>
            )}
            {step === 'confirm' && (
              <div className="flex flex-col gap-2 lg:flex-row-reverse">
                <Button
                  className="lg:flex-1"
                  disabled={selected.length === 0}
                  onClick={() => save(true)}
                >
                  Save and draw another
                </Button>
                <Button
                  variant="outline"
                  className="lg:flex-1"
                  disabled={selected.length === 0}
                  onClick={() => save(false)}
                >
                  Save and exit
                </Button>
              </div>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
