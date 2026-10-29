import { Fragment, useState } from 'react'
import dynamic from 'next/dynamic'
import { Catalog } from '@a2ui/web_core/v0_9'
import {
  createComponentImplementation,
  type ReactComponentImplementation,
} from '@a2ui/react/v0_9'
import {
  ActionButtonApi,
  ChoiceQuestionApi,
  ContactCardApi,
  GENERATED_UI_A2UI_CATALOG_ID,
  GENERATED_UI_SEND_MESSAGE_EVENT,
  HeadingApi,
  MapCardApi,
  OutreachCardApi,
  StackApi,
  StatApi,
  TableApi,
  TextApi,
} from '@goodparty_org/contracts/genui-a2ui'
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
import { OPTION_CARD_CLASS, OPTION_CARD_INTERACTIVE_CLASS } from '../optionCard'
import { InitialsAvatar } from '../cards/cardShell'
import {
  PROPOSAL_OUTREACH_TYPE,
  peopleCount,
} from '../cards/proposalPresentation'

const GeneratedUiMap = dynamic(() => import('./GeneratedUiMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
})

const GAP_CLASS = { sm: 'gap-2', md: 'gap-4', lg: 'gap-6' } as const

const Stack = createComponentImplementation(
  StackApi,
  ({ props, buildChild }) => (
    <div
      className={cn(
        'flex',
        props.direction === 'horizontal' ? 'flex-row flex-wrap' : 'flex-col',
        GAP_CLASS[props.gap ?? 'md'],
      )}
    >
      {props.children.map((child, i) => (
        <Fragment key={typeof child === 'string' ? child : `${child.id}-${i}`}>
          {typeof child === 'string'
            ? buildChild(child)
            : buildChild(child.id, child.basePath)}
        </Fragment>
      ))}
    </div>
  ),
)

const Heading = createComponentImplementation(HeadingApi, ({ props }) => (
  <h3 className="text-lg font-semibold text-foreground">{props.text}</h3>
))

const Text = createComponentImplementation(TextApi, ({ props }) => (
  <p
    className={cn(
      'text-sm leading-6',
      props.variant === 'muted' ? 'text-muted-foreground' : 'text-foreground',
    )}
  >
    {props.text}
  </p>
))

const Stat = createComponentImplementation(StatApi, ({ props }) => (
  <div className={cn(OPTION_CARD_CLASS, 'flex min-w-36 flex-1 flex-col gap-1')}>
    <span className="text-sm text-muted-foreground">{props.label}</span>
    <span className="text-2xl font-semibold text-foreground">
      {props.value}
    </span>
    {props.delta ? (
      <span className="text-sm font-medium text-foreground">{props.delta}</span>
    ) : null}
    {props.caption ? (
      <span className="text-xs text-muted-foreground">{props.caption}</span>
    ) : null}
  </div>
))

const DataTable = createComponentImplementation(TableApi, ({ props }) => (
  <div className="overflow-hidden rounded-xl border border-border bg-card">
    <Table>
      <TableHeader>
        <TableRow>
          {props.columns.map((column, i) => (
            <TableHead key={`${column}-${i}`}>{column}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.rows.map((row, r) => (
          <TableRow key={r}>
            {props.columns.map((column, c) => (
              <TableCell
                key={`${column}-${c}`}
                className="h-auto whitespace-normal py-3 align-top"
              >
                {row[c] ?? ''}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </div>
))

const telHref = (phone: string) => `tel:${phone.replace(/[^0-9+]/g, '')}`

const ContactCard = createComponentImplementation(
  ContactCardApi,
  ({ props, context }) => {
    const subtitle = [props.role, props.organization]
      .filter((part): part is string => Boolean(part))
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
              <span className="truncate text-sm text-muted-foreground">
                {subtitle}
              </span>
            ) : null}
          </div>
        </div>
        {props.note ? (
          <p className="text-sm leading-6 text-foreground">{props.note}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {props.phone ? (
            <Button asChild size="small">
              <a href={telHref(props.phone)}>
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
          <Button
            type="button"
            size="small"
            variant="outline"
            onClick={() =>
              context.dispatchAction({
                event: {
                  name: GENERATED_UI_SEND_MESSAGE_EVENT,
                  context: { text: `What should I know about ${props.name}?` },
                },
              })
            }
          >
            <MessageSquareIcon className="size-4" aria-hidden />
            Ask about them
          </Button>
        </div>
      </div>
    )
  },
)

const MapCard = createComponentImplementation(MapCardApi, ({ props }) => (
  <div className="flex flex-col gap-2">
    <span className="text-sm font-medium text-foreground">{props.title}</span>
    <GeneratedUiMap
      center={props.center}
      markers={props.markers}
      {...(props.zoom !== undefined && { zoom: props.zoom })}
    />
  </div>
))

const OUTREACH_CHANNEL = {
  text: 'text',
  call: 'phoneBanking',
  door: 'doorKnocking',
  social: 'social',
} as const

const OutreachCard = createComponentImplementation(
  OutreachCardApi,
  ({ props, context }) => {
    const channel = OUTREACH_CHANNEL[props.channel]
    const subtitle = [
      getChannelLabel(PROPOSAL_OUTREACH_TYPE[channel]),
      props.channel === 'social' ? '' : peopleCount(props.audienceCount),
    ]
      .filter(Boolean)
      .join(' · ')
    return (
      <div className={cn(OPTION_CARD_CLASS, 'flex max-w-md flex-col gap-3')}>
        <div className="flex items-center gap-3">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium text-foreground">
              {props.audience}
            </span>
            <span className="truncate text-sm leading-6 text-muted-foreground">
              {subtitle}
            </span>
          </span>
          <Button
            type="button"
            size="small"
            className="shrink-0"
            onClick={() =>
              context.dispatchAction({
                event: {
                  name: GENERATED_UI_SEND_MESSAGE_EVENT,
                  context: {
                    text: `Let's set up the ${props.channel} outreach`,
                  },
                },
              })
            }
          >
            {props.ctaLabel ?? 'Set it up'}
          </Button>
        </div>
        <p className="whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm leading-6 text-foreground">
          {props.message}
        </p>
      </div>
    )
  },
)

const ChoiceQuestion = createComponentImplementation(
  ChoiceQuestionApi,
  ({ props, context }) => {
    const [picked, setPicked] = useState<string[]>(props.value ?? [])
    const [sent, setSent] = useState(false)
    const promptId = `${context.componentModel.id}-question`
    const pick = (next: string[]) => {
      const ordered = props.options.filter((option) => next.includes(option))
      setPicked(ordered)
      props.setValue(ordered)
    }
    const rowClass = cn(
      OPTION_CARD_CLASS,
      'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5',
      !sent && OPTION_CARD_INTERACTIVE_CLASS,
    )
    return (
      <div className="flex max-w-md flex-col gap-3">
        <p id={promptId} className="text-sm font-medium text-foreground">
          {props.question}
        </p>
        {props.multi ? (
          <div
            role="group"
            aria-labelledby={promptId}
            className="flex flex-col gap-2"
          >
            {props.options.map((option, i) => {
              const id = `${promptId}-${i}`
              return (
                <div key={id} className={rowClass}>
                  <Label
                    htmlFor={id}
                    className="flex cursor-pointer items-center gap-3 text-left"
                  >
                    <Checkbox
                      id={id}
                      checked={picked.includes(option)}
                      disabled={sent}
                      onCheckedChange={(state) =>
                        pick(
                          state === true
                            ? [...picked, option]
                            : picked.filter((p) => p !== option),
                        )
                      }
                      className="shrink-0 disabled:opacity-100"
                    />
                    <span className="text-sm font-medium text-foreground">
                      {option}
                    </span>
                  </Label>
                </div>
              )
            })}
          </div>
        ) : (
          <RadioGroup
            aria-labelledby={promptId}
            className="flex flex-col gap-2"
            disabled={sent}
            value={picked[0] ?? ''}
            onValueChange={(value) => pick([value])}
          >
            {props.options.map((option, i) => {
              const id = `${promptId}-${i}`
              return (
                <div key={id} className={rowClass}>
                  <Label
                    htmlFor={id}
                    className="flex cursor-pointer items-center gap-3 text-left"
                  >
                    <RadioGroupItem
                      id={id}
                      value={option}
                      className="shrink-0 disabled:opacity-100"
                    />
                    <span className="text-sm font-medium text-foreground">
                      {option}
                    </span>
                  </Label>
                </div>
              )
            })}
          </RadioGroup>
        )}
        {sent ? null : (
          <Button
            type="button"
            size="small"
            className="self-start"
            disabled={picked.length === 0}
            onClick={() => {
              setSent(true)
              void props.submit()
            }}
          >
            {picked.length > 1 ? 'Use these' : 'Use this'}
          </Button>
        )}
      </div>
    )
  },
)

const ActionButton = createComponentImplementation(
  ActionButtonApi,
  ({ props }) => (
    <Button
      type="button"
      size="small"
      className="self-start"
      variant={props.variant === 'secondary' ? 'outline' : 'default'}
      onClick={() => void props.action()}
    >
      {props.label}
    </Button>
  ),
)

const COMPONENTS: ReactComponentImplementation[] = [
  Stack,
  Heading,
  Text,
  Stat,
  DataTable,
  ContactCard,
  MapCard,
  OutreachCard,
  ChoiceQuestion,
  ActionButton,
]

export const generatedUiA2uiReactCatalog = new Catalog(
  GENERATED_UI_A2UI_CATALOG_ID,
  'v0.9',
  COMPONENTS,
  [],
)
