'use client'

import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@goodparty_org/styleguide'
import { data, nextRun, type Area, type EventRecord } from '../lib/data'
import { PRODUCT_LABEL, productOf, type Product } from '../lib/lineage'
import { search, suggestions } from '../lib/search'
import { EventTable } from '../components/EventTable'
import { MultiSelect } from '../components/MultiSelect'
import { QuestionCard } from '../components/QuestionCard'
import { Section } from '../components/Section'
import { WhatsNext } from '../components/WhatsNext'

const when = (iso: string) =>
  iso
    ? new Date(iso).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
      }) + ' UTC'
    : 'unknown'

const PRODUCTS: Product[] = ['win', 'serve', 'shared', 'untagged']

// Radix Select cannot take an empty-string value, so the "no filter" option needs one.
const ALL_AREAS = '__all__'

// Grouped so the filter reads as questions people ask ("what still works?") rather than
// as the eight-value status enum underneath.
const STATUS_GROUPS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'working', label: 'Working', statuses: ['active'] },
  {
    key: 'suspect',
    label: 'Suspect',
    statuses: ['dormant', 'instrumented_never_observed', 'orphaned_firing'],
  },
  { key: 'removed', label: 'Removed', statuses: ['retired', 'deprecating'] },
  { key: 'auto', label: 'Auto-tracked', statuses: ['system', 'code_unknown'] },
]

const Dot = ({
  n,
  className,
  title,
}: {
  n: number
  className: string
  title: string
}) =>
  n > 0 ? (
    <span
      title={title}
      className="inline-flex items-center gap-1 text-xs tabular-nums"
    >
      <span className={`inline-block h-2 w-2 rounded-full ${className}`} />
      {n}
    </span>
  ) : null

// The dots would otherwise carry state by colour alone, which excludes anyone who
// cannot separate the hues and anyone printing the page.
const Legend = () => (
  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
    {[
      ['bg-success', 'active'],
      ['bg-warning', 'dormant'],
      ['bg-error', 'orphaned or never seen'],
      ['bg-muted-foreground/40', 'retired'],
    ].map(([cls, label]) => (
      <span key={label} className="inline-flex items-center gap-1">
        <span className={`inline-block h-2 w-2 rounded-full ${cls}`} />
        {label}
      </span>
    ))}
  </div>
)

const Pill = ({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={on}
    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
      on ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted'
    }`}
  >
    {children}
  </button>
)

const AreaCard = ({
  area,
  active,
  onClick,
}: {
  area: Area
  active: boolean
  onClick: () => void
}) => {
  const c = area.counts
  const broken = (c.orphaned_firing ?? 0) + (c.instrumented_never_observed ?? 0)
  const nothingWorks = (c.active ?? 0) === 0 && area.total > 2
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 ${
        active ? 'border-foreground bg-muted/50' : ''
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium">{area.name}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {area.total}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Dot n={c.active ?? 0} className="bg-success" title="active" />
        <Dot n={c.dormant ?? 0} className="bg-warning" title="dormant" />
        <Dot
          n={broken}
          className="bg-error"
          title="orphaned or never observed"
        />
        <Dot
          n={c.retired ?? 0}
          className="bg-muted-foreground/40"
          title="retired"
        />
      </div>
      {nothingWorks && (
        <div className="mt-2 text-xs font-medium text-error-dark">
          nothing here is working
        </div>
      )}
    </button>
  )
}

export const Explore = () => {
  const [query, setQuery] = useState('')
  const [area, setArea] = useState<string | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [statusKeys, setStatusKeys] = useState<string[]>([])
  const [questionId, setQuestionId] = useState<string | null>(null)
  const [addedAfter, setAddedAfter] = useState('')
  const [minVolume, setMinVolume] = useState('')

  const results = useMemo(() => search(query), [query])
  const searching = query.trim().length > 0

  const productCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const e of data.events) c[productOf(e)] = (c[productOf(e)] ?? 0) + 1
    return c
  }, [])

  const activeQuestion = useMemo(
    () => data.questions.find((q) => q.id === questionId) ?? null,
    [questionId],
  )

  // Clicking a question narrows to the events that answer it. The registry usually
  // names only one or two, which is honest but rarely what someone wants to see, so
  // the events sharing those events' product areas come back as a second, labelled
  // tier rather than being hidden.
  const questionScope = useMemo(() => {
    if (!activeQuestion) return null
    const named = new Set(
      activeQuestion.surfaces
        .map((s) => s.instrumented_by)
        .filter(Boolean) as string[],
    )
    const answering = data.events.filter((e) => named.has(e.display_name))
    const areas = new Set(answering.map((e) => e.area))
    const answeringTypes = new Set(answering.map((e) => e.event_type))
    const related = data.events.filter(
      (e) => areas.has(e.area) && !answeringTypes.has(e.event_type),
    )
    return { answering, related, areas: [...areas] }
  }, [activeQuestion])

  const allowedStatuses = useMemo(() => {
    if (!statusKeys.length) return null
    return new Set(
      STATUS_GROUPS.filter((g) => statusKeys.includes(g.key)).flatMap(
        (g) => g.statuses,
      ),
    )
  }, [statusKeys])

  const narrow = useMemo(
    () => (list: EventRecord[]) => {
      let base = list
      if (area) base = base.filter((e) => e.area === area)
      if (products.length)
        base = base.filter((e) => products.includes(productOf(e)))
      if (allowedStatuses)
        base = base.filter((e) => allowedStatuses.has(e.status))
      if (addedAfter) {
        // An event with no attributable commit has no date to compare, so a date
        // filter necessarily drops it rather than guessing it is old.
        base = base.filter((e) => e.provenance.instrumented_date >= addedAfter)
      }
      const min = Number(minVolume)
      if (minVolume && Number.isFinite(min))
        base = base.filter((e) => e.count_30d >= min)
      return base
    },
    [area, products, allowedStatuses, addedAfter, minVolume],
  )

  // Picking a question replaces the text search as the selection: the intent has moved
  // from "find something" to "show me this one's events".
  const tableEvents: EventRecord[] = useMemo(() => {
    if (questionScope) return narrow(questionScope.answering)
    return narrow(searching ? results.events.map((h) => h.item) : data.events)
  }, [searching, results, narrow, questionScope])

  const relatedEvents: EventRecord[] = useMemo(
    () => (questionScope ? narrow(questionScope.related) : []),
    [narrow, questionScope],
  )

  const visibleQuestions = useMemo(
    () =>
      products.length
        ? data.questions.filter((q) => products.includes(q.product as Product))
        : data.questions,
    [products],
  )

  const brokenQuestions = visibleQuestions.filter(
    (q) => q.coverage !== 'covered',
  ).length
  const toggle = <T,>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v]

  const filtersOn = Boolean(
    area ||
    products.length ||
    statusKeys.length ||
    questionId ||
    addedAfter ||
    minVolume,
  )

  return (
    <div className="mx-auto max-w-6xl p-6">
      {/* Sticky so "how fresh is this?" never requires scrolling back up. */}
      <div className="sticky top-0 z-20 -mx-6 mb-4 border-b bg-background/95 px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-xl font-semibold">Analytics Events Explorer</h1>
          <p className="text-xs text-muted-foreground">
            {data.events.length} events · {data.questions.length} questions ·{' '}
            {data.areas.length} areas · data as of {when(data.refreshed_at)} ·
            next refresh {when(nextRun().toISOString())}
          </p>
        </div>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="How do we measure…?  Try an event name, a question, or a product area."
            className="pl-9 pr-9"
          />
          {searching && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Product</span>
          {PRODUCTS.map((p) => (
            <Pill
              key={p}
              on={products.includes(p)}
              onClick={() => setProducts(toggle(products, p))}
            >
              {PRODUCT_LABEL[p]} {productCounts[p] ?? 0}
            </Pill>
          ))}
          {filtersOn && (
            <Button
              size="small"
              variant="ghost"
              onClick={() => {
                setArea(null)
                setProducts([])
                setStatusKeys([])
                setQuestionId(null)
                setAddedAfter('')
                setMinVolume('')
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {!searching && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            Try:
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setQuery(s)}
                className="rounded-full border px-2 py-0.5 hover:bg-muted"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {searching && results.total === 0 && (
          <Card>
            <CardContent className="space-y-2 p-6">
              <p className="font-medium">Nothing matches “{query}”.</p>
              <p className="text-sm text-muted-foreground">
                That may mean we do not measure it yet.
              </p>
              <div className="flex flex-wrap gap-2">
                {data.request_form_url && (
                  <Button asChild size="small" variant="outline">
                    <a
                      href={data.request_form_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Ask for it to be measured
                    </a>
                  </Button>
                )}
                <Button asChild size="small" variant="ghost">
                  <a
                    href="https://goodpartyorg.slack.com/archives/C0BECEK0603"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ask in #product-analytics
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {searching && results.questions.length > 0 && (
          <Section title="Questions" count={results.questions.length}>
            <div className="space-y-3">
              {results.questions.slice(0, 4).map((h) => (
                <QuestionCard
                  key={h.item.id}
                  question={h.item}
                  selected={questionId === h.item.id}
                  onSelect={() =>
                    setQuestionId(questionId === h.item.id ? null : h.item.id)
                  }
                />
              ))}
            </div>
          </Section>
        )}

        {searching && results.areas.length > 0 && (
          <Section title="Product areas" count={results.areas.length}>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {results.areas.slice(0, 8).map((h) => (
                <AreaCard
                  key={h.item.name}
                  area={h.item}
                  active={area === h.item.name}
                  onClick={() =>
                    setArea(area === h.item.name ? null : h.item.name)
                  }
                />
              ))}
            </div>
          </Section>
        )}

        {!searching && (
          <>
            <Section
              title="By product area"
              count={data.areas.length}
              aside={<Legend />}
            >
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-5">
                {data.areas.slice(0, 20).map((a) => (
                  <AreaCard
                    key={a.name}
                    area={a}
                    active={area === a.name}
                    onClick={() => setArea(area === a.name ? null : a.name)}
                  />
                ))}
              </div>
            </Section>

            <Section
              title="By business question"
              count={visibleQuestions.length}
              defaultOpen={false}
              aside={
                <Badge variant="outline" className="normal-case">
                  {brokenQuestions} not fully answerable
                </Badge>
              }
            >
              <div className="space-y-3">
                {visibleQuestions.map((q) => (
                  <QuestionCard
                    key={q.id}
                    question={q}
                    selected={questionId === q.id}
                    onSelect={() =>
                      setQuestionId(questionId === q.id ? null : q.id)
                    }
                  />
                ))}
              </div>
            </Section>
          </>
        )}

        <Section
          title={
            activeQuestion
              ? 'Events answering this question'
              : searching
                ? 'Events'
                : 'All events'
          }
          count={tableEvents.length}
          aside={
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={area ?? ALL_AREAS}
                onValueChange={(v) => setArea(v === ALL_AREAS ? null : v)}
              >
                <SelectTrigger className="h-7 w-[180px] text-xs">
                  <SelectValue placeholder="All areas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_AREAS}>All areas</SelectItem>
                  {data.areas.map((a) => (
                    <SelectItem key={a.name} value={a.name}>
                      {a.name} ({a.total})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <MultiSelect
                label="States"
                selected={statusKeys}
                onChange={setStatusKeys}
                options={STATUS_GROUPS.map((g) => ({
                  value: g.key,
                  label: g.label,
                  count: data.events.filter((e) =>
                    g.statuses.includes(e.status),
                  ).length,
                }))}
              />
              <MultiSelect
                label="Products"
                selected={products}
                onChange={(next) => setProducts(next as Product[])}
                options={PRODUCTS.map((pr) => ({
                  value: pr,
                  label: PRODUCT_LABEL[pr],
                  count: productCounts[pr] ?? 0,
                }))}
              />
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                Added after
                <input
                  type="date"
                  value={addedAfter}
                  onChange={(e) => setAddedAfter(e.target.value)}
                  className="h-7 rounded-md border bg-background px-2 text-xs text-foreground"
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                Min 30d
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={minVolume}
                  onChange={(e) => setMinVolume(e.target.value)}
                  placeholder="0"
                  className="h-7 w-[74px] rounded-md border bg-background px-2 text-xs text-foreground"
                />
              </label>
              {activeQuestion && (
                <Button
                  size="small"
                  variant="ghost"
                  onClick={() => setQuestionId(null)}
                >
                  answering: {activeQuestion.question.slice(0, 40)}…{' '}
                  <X className="ml-1 h-3 w-3" />
                </Button>
              )}
            </div>
          }
        >
          <div className="space-y-2">
            <EventTable events={tableEvents.slice(0, 150)} />
            {tableEvents.length > 150 && (
              <p className="text-xs text-muted-foreground">
                Showing the first 150 of {tableEvents.length}. Narrow with
                search or a filter.
              </p>
            )}
          </div>
        </Section>

        {questionScope && relatedEvents.length > 0 && (
          <Section
            title={`Others in ${questionScope.areas.join(', ')}`}
            count={relatedEvents.length}
            defaultOpen={false}
            aside={
              <span className="text-xs text-muted-foreground">
                not named by this question, but in the same part of the product
              </span>
            }
          >
            <EventTable events={relatedEvents.slice(0, 150)} />
          </Section>
        )}

        <WhatsNext />
      </div>
    </div>
  )
}
