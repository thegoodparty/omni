'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { defineCatalog } from '@json-render/core'
import {
  defineRegistry,
  JSONUIProvider,
  Renderer,
  schema,
  useActions,
  useBoundProp,
  type Components,
} from '@json-render/react'
import {
  GENERATED_UI_CATALOG_DATA,
  type GeneratedUiSpec,
} from '@goodparty_org/contracts'
import {
  Button,
  Checkbox,
  cn,
  Label,
  RadioGroup,
  RadioGroupItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@styleguide'
import {
  MailIcon,
  MessageSquareIcon,
  PhoneIcon,
} from '@styleguide/components/ui/icons'
import { getChannelLabel } from 'app/dashboard/outreach/v2/channelMeta'
import { formatClarifyChoices } from '../ClarifyQuestionWidget'
import { OPTION_CARD_CLASS, OPTION_CARD_INTERACTIVE_CLASS } from '../optionCard'
import { InitialsAvatar } from '../cards/cardShell'
import {
  PROPOSAL_OUTREACH_TYPE,
  peopleCount,
} from '../cards/proposalPresentation'

// maplibre-gl touches `window` at module scope.
const GeneratedUiMap = dynamic(() => import('./GeneratedUiMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
})

export const generatedUiCatalog = defineCatalog(
  schema,
  GENERATED_UI_CATALOG_DATA,
)

const OUTREACH_CARD_CHANNEL = {
  text: 'text',
  call: 'phoneBanking',
  door: 'doorKnocking',
  social: 'social',
} as const

const GAP = { small: 'gap-2', medium: 'gap-4', large: 'gap-6' } as const

const components: Components<typeof generatedUiCatalog> = {
  Stack: ({ props, children }) => (
    <div
      className={cn(
        props.direction === 'horizontal'
          ? 'grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]'
          : 'flex flex-col',
        GAP[props.gap ?? 'medium'],
      )}
    >
      {children}
    </div>
  ),
  Heading: ({ props }) =>
    props.level === 'section' ? (
      <h3 className="text-base font-semibold text-foreground">{props.text}</h3>
    ) : (
      <h2 className="text-lg font-semibold text-foreground">{props.text}</h2>
    ),
  Text: ({ props }) => (
    <p
      className={cn(
        'text-sm leading-6',
        props.variant === 'muted' ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      {props.text}
    </p>
  ),
  Stat: ({ props }) => (
    <div className={cn(OPTION_CARD_CLASS, 'flex flex-col gap-1')}>
      <span className="text-sm text-muted-foreground">{props.label}</span>
      <span className="text-2xl font-semibold text-foreground">
        {props.value}
      </span>
      {props.delta ? (
        <span className="text-sm font-medium text-foreground">
          {props.delta}
        </span>
      ) : null}
      {props.caption ? (
        <span className="text-xs text-muted-foreground">{props.caption}</span>
      ) : null}
    </div>
  ),
  Table: ({ props }) => (
    <div className={cn(OPTION_CARD_CLASS, 'p-0')}>
      <Table>
        <TableHeader>
          <TableRow>
            {props.columns.map((column, i) => (
              <TableHead key={i}>{column}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.rows.map((row, i) => (
            <TableRow key={i}>
              {props.columns.map((_, j) => (
                <TableCell key={j} className="whitespace-normal">
                  {row[j] ?? ''}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
  ContactCard: ({ props, on }) => {
    const { execute } = useActions()
    const ask = (): void => {
      const event = on('ask')
      if (event.bound) return event.emit()
      void execute({
        action: 'send_message',
        params: { text: `Tell me more about ${props.name}.` },
      })
    }
    const subtitle = [props.role, props.organization]
      .filter(Boolean)
      .join(' · ')
    return (
      <div className={cn(OPTION_CARD_CLASS, 'flex max-w-md flex-col gap-3')}>
        <div className="flex items-center gap-3">
          <InitialsAvatar name={props.name} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-foreground">
              {props.name}
            </span>
            {subtitle ? (
              <span className="text-sm leading-6 text-muted-foreground">
                {subtitle}
              </span>
            ) : null}
          </div>
        </div>
        {props.note ? (
          <p className="text-sm text-muted-foreground">{props.note}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {props.phone ? (
            <Button asChild size="small">
              <a href={`tel:${props.phone.replace(/[^0-9+]/g, '')}`}>
                <PhoneIcon className="size-4" aria-hidden />
                Call
              </a>
            </Button>
          ) : null}
          {props.email ? (
            <Button
              asChild
              size="small"
              variant={props.phone ? 'outline' : 'default'}
            >
              <a href={`mailto:${props.email}`}>
                <MailIcon className="size-4" aria-hidden />
                Email
              </a>
            </Button>
          ) : null}
          <Button type="button" size="small" variant="outline" onClick={ask}>
            <MessageSquareIcon className="size-4" aria-hidden />
            Ask about them
          </Button>
        </div>
      </div>
    )
  },
  MapCard: ({ props }) => (
    <div className={cn(OPTION_CARD_CLASS, 'flex flex-col gap-3')}>
      <span className="text-sm font-medium text-foreground">{props.title}</span>
      <GeneratedUiMap
        center={props.center}
        zoom={props.zoom}
        markers={props.markers}
      />
      <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
        {props.markers.map((marker, i) => (
          <li key={i}>{marker.label}</li>
        ))}
      </ul>
    </div>
  ),
  OutreachCard: ({ props, on }) => {
    const { execute } = useActions()
    const press = (): void => {
      const event = on('press')
      if (event.bound) return event.emit()
      void execute({
        action: 'send_message',
        params: { text: `Let's set up the ${props.channel} outreach` },
      })
    }
    const channel = OUTREACH_CARD_CHANNEL[props.channel]
    return (
      <div className={cn(OPTION_CARD_CLASS, 'flex max-w-md flex-col gap-3')}>
        <div className="flex items-center gap-3">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-medium text-foreground">
              {props.audience}
            </span>
            <span className="text-sm leading-6 text-muted-foreground">
              {[
                getChannelLabel(PROPOSAL_OUTREACH_TYPE[channel]),
                peopleCount(props.audienceCount),
              ].join(' · ')}
            </span>
          </span>
          <Button
            type="button"
            size="small"
            className="shrink-0"
            onClick={press}
            data-testid="generated-ui-outreach-cta"
          >
            {props.ctaLabel}
          </Button>
        </div>
        <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm text-foreground">
          {props.messagePreview}
        </p>
      </div>
    )
  },
  ChoiceQuestion: ({ props, bindings, on }) => {
    const { execute } = useActions()
    const [boundValue, setBoundValue] = useBoundProp<string[]>(
      props.value,
      bindings?.value,
    )
    const [localValue, setLocalValue] = useState<string[]>([])
    const [submitted, setSubmitted] = useState(false)
    const selected = bindings?.value ? (boundValue ?? []) : localValue
    const setSelected = bindings?.value ? setBoundValue : setLocalValue
    // Option order, not click order, so the answer reads like a clarify one.
    const choose = (label: string, checked: boolean): void =>
      setSelected(
        props.options.filter((option) =>
          option === label
            ? checked
            : props.multi
              ? selected.includes(option)
              : false,
        ),
      )
    const submit = (): void => {
      if (selected.length === 0) return
      setSubmitted(true)
      const event = on('submit')
      if (event.bound) return event.emit()
      void execute({
        action: 'submit_choices',
        params: { choices: selected },
      })
    }
    const optionClass = cn(
      'flex items-center gap-3',
      OPTION_CARD_CLASS,
      'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5',
      !submitted && OPTION_CARD_INTERACTIVE_CLASS,
    )
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium text-foreground">{props.question}</p>
        {props.multi ? (
          <div role="group" className="flex flex-col gap-2">
            {props.options.map((option) => (
              <Label key={option} className={optionClass}>
                <Checkbox
                  checked={selected.includes(option)}
                  onCheckedChange={(state) => choose(option, state === true)}
                  disabled={submitted}
                  aria-label={option}
                />
                <span className="text-sm font-medium text-foreground">
                  {option}
                </span>
              </Label>
            ))}
          </div>
        ) : (
          <RadioGroup
            className="flex flex-col gap-2"
            disabled={submitted}
            value={selected[0] ?? ''}
            onValueChange={(value) => choose(value, true)}
          >
            {props.options.map((option) => (
              <Label key={option} className={optionClass}>
                <RadioGroupItem value={option} aria-label={option} />
                <span className="text-sm font-medium text-foreground">
                  {option}
                </span>
              </Label>
            ))}
          </RadioGroup>
        )}
        <Button
          type="button"
          size="small"
          className="self-start"
          onClick={submit}
          disabled={submitted || selected.length === 0}
        >
          Submit
        </Button>
      </div>
    )
  },
  ActionButton: ({ props, on }) => {
    const { execute } = useActions()
    const press = (): void => {
      const event = on('press')
      if (event.bound) return event.emit()
      void execute({
        action: 'send_message',
        params: { text: props.message },
      })
    }
    return (
      <Button
        type="button"
        size="small"
        variant="outline"
        className="self-start"
        onClick={press}
      >
        {props.label}
      </Button>
    )
  },
}

const UnknownComponent = () => null

// Renders one spec. Each mount gets its own state store seeded from
// spec.state, so a reloaded card starts unanswered.
export const GeneratedUi = ({
  spec,
  onSendMessage,
}: {
  spec: GeneratedUiSpec
  onSendMessage: (text: string) => void
}) => {
  const sendRef = useRef(onSendMessage)
  useEffect(() => {
    sendRef.current = onSendMessage
  })
  // ActionProvider keeps the handlers it mounted with, so they read the
  // sender through a ref instead of closing over it.
  const { registry, handlers } = useMemo(
    () =>
      defineRegistry(generatedUiCatalog, {
        components,
        actions: {
          send_message: async (params) => {
            if (params?.text) sendRef.current(params.text)
          },
          submit_choices: async (params) => {
            if (params?.choices.length) {
              sendRef.current(formatClarifyChoices(params.choices))
            }
          },
        },
      }),
    [],
  )
  const actionHandlers = useMemo(
    () =>
      handlers(
        () => undefined,
        () => ({}),
      ),
    [handlers],
  )
  return (
    <JSONUIProvider
      registry={registry}
      initialState={spec.state}
      handlers={actionHandlers}
    >
      <Renderer spec={spec} registry={registry} fallback={UnknownComponent} />
    </JSONUIProvider>
  )
}
