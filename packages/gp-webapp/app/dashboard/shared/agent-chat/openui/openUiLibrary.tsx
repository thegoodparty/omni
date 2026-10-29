import dynamic from 'next/dynamic'
import {
  createLibrary,
  defineComponent,
  useIsStreaming,
  useStateField,
  useTriggerAction,
  type ActionPlan,
  type ComponentRenderProps,
} from '@openuidev/react-lang'
import type { z } from 'zod'
import {
  OpenUiActionButton,
  OpenUiChoiceQuestion,
  OpenUiContactCard,
  OpenUiHeading,
  OpenUiMapCard,
  OpenUiOutreachCard,
  OpenUiStack,
  OpenUiStartOutreach,
  OpenUiStat,
  OpenUiTable,
  OpenUiText,
  type OPEN_UI_OUTREACH_CHANNELS,
} from '@goodparty_org/contracts/openui'
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
  DoorOpenIcon,
  MailIcon,
  MessageSquareIcon,
  PhoneIcon,
  Share2Icon,
} from '@styleguide/components/ui/icons'
import { getChannelLabel } from 'app/dashboard/outreach/v2/channelMeta'
import { formatClarifyChoices } from '../ClarifyQuestionWidget'
import { OPTION_CARD_CLASS, OPTION_CARD_INTERACTIVE_CLASS } from '../optionCard'
import { InitialsAvatar } from '../cards/cardShell'
import {
  PROPOSAL_OUTREACH_TYPE,
  SERVE_PROPOSAL_CTA,
  peopleCount,
} from '../cards/proposalPresentation'

type OpenUiChannel = (typeof OPEN_UI_OUTREACH_CHANNELS)[number]

const PROPOSAL_CHANNEL = {
  text: 'text',
  call: 'phoneBanking',
  door: 'doorKnocking',
  social: 'social',
} as const satisfies Record<OpenUiChannel, string>

const CHANNEL_ICON = {
  text: MessageSquareIcon,
  call: PhoneIcon,
  door: DoorOpenIcon,
  social: Share2Icon,
} satisfies Record<OpenUiChannel, typeof PhoneIcon>

export const OPEN_UI_COPY = {
  askAbout: 'Ask about them',
  askAboutMessage: (name: string) => `Tell me more about ${name}.`,
  call: 'Call',
  email: 'Email',
  startOutreach: (channel: OpenUiChannel) =>
    `Let's set up the ${channel} outreach`,
  useThis: 'Use this',
  useThese: 'Use these',
}

const telHref = (phone: string) => `tel:${phone.replace(/[^0-9+]/g, '')}`

const GAP_CLASS = {
  small: 'gap-2',
  medium: 'gap-3',
  large: 'gap-5',
}

const Stack = defineComponent({
  ...OpenUiStack,
  component: ({ props, renderNode }) => (
    <div
      className={cn(
        'flex',
        props.direction === 'horizontal'
          ? 'flex-row flex-wrap [&>*]:min-w-36 [&>*]:flex-1'
          : 'flex-col',
        GAP_CLASS[props.gap ?? 'medium'],
      )}
    >
      {renderNode(props.children)}
    </div>
  ),
})

const Heading = defineComponent({
  ...OpenUiHeading,
  component: ({ props }) => (
    <h3 className="text-base font-semibold text-foreground">{props.text}</h3>
  ),
})

const Text = defineComponent({
  ...OpenUiText,
  component: ({ props }) => (
    <p
      className={cn(
        'text-sm leading-6',
        props.variant === 'muted' ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      {props.text}
    </p>
  ),
})

const Stat = defineComponent({
  ...OpenUiStat,
  component: ({ props }) => (
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
})

const DataTable = defineComponent({
  ...OpenUiTable,
  component: ({ props }) => (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {(props.columns ?? []).map((column, i) => (
              <TableHead key={i}>{column}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {(props.rows ?? []).map((row, i) => (
            <TableRow key={i}>
              {row.map((cell, j) => (
                <TableCell key={j}>{cell}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
})

// Named components rather than inline `component:` arrows, so the hooks
// inside them read as hooks in a component to the rules-of-hooks lint.
const ContactCardView = ({
  props,
}: ComponentRenderProps<z.infer<typeof OpenUiContactCard.props>>) => {
  const triggerAction = useTriggerAction()
  const subtitle = [props.role, props.organization].filter(Boolean).join(' · ')
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
        <p className="text-sm leading-6 text-muted-foreground">{props.note}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {props.phone ? (
          <Button asChild size="small">
            <a href={telHref(props.phone)}>
              <PhoneIcon className="size-4" aria-hidden />
              {OPEN_UI_COPY.call}
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
              {OPEN_UI_COPY.email}
            </a>
          </Button>
        ) : null}
        <Button
          type="button"
          size="small"
          variant="outline"
          onClick={() =>
            triggerAction(OPEN_UI_COPY.askAboutMessage(props.name))
          }
        >
          {OPEN_UI_COPY.askAbout}
        </Button>
      </div>
    </div>
  )
}

const ContactCard = defineComponent({
  ...OpenUiContactCard,
  component: ContactCardView,
})

// maplibre-gl touches `window` at module scope, so the canvas stays out of
// the server bundle, as ChatListMap does.
const OpenUiMapCanvas = dynamic(() => import('./OpenUiMapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
})

const MapCard = defineComponent({
  ...OpenUiMapCard,
  component: ({ props }) => (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-foreground">{props.title}</span>
      {props.center ? (
        <OpenUiMapCanvas
          center={props.center}
          zoom={props.zoom ?? 13}
          markers={props.markers ?? []}
        />
      ) : null}
    </div>
  ),
})

const startOutreachPlan = (channel: OpenUiChannel): ActionPlan => ({
  steps: [
    {
      type: 'custom_action',
      name: OpenUiStartOutreach.name,
      params: { channel },
    },
  ],
})

const OutreachCardView = ({
  props,
}: ComponentRenderProps<z.infer<typeof OpenUiOutreachCard.props>>) => {
  const triggerAction = useTriggerAction()
  const ChannelIcon = CHANNEL_ICON[props.channel] ?? MessageSquareIcon
  const proposalChannel = PROPOSAL_CHANNEL[props.channel] ?? 'text'
  return (
    <div className={cn(OPTION_CARD_CLASS, 'flex max-w-md flex-col gap-3')}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <ChannelIcon className="size-3.5" aria-hidden />
        {getChannelLabel(PROPOSAL_OUTREACH_TYPE[proposalChannel])}
      </div>
      <div className="flex flex-col">
        <span className="text-sm font-medium text-foreground">
          {props.audience}
        </span>
        {typeof props.audienceCount === 'number' ? (
          <span className="text-sm text-muted-foreground">
            {peopleCount(props.audienceCount, 'serve')}
          </span>
        ) : null}
      </div>
      {props.message ? (
        <p className="line-clamp-4 whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm leading-6 text-foreground">
          {props.message}
        </p>
      ) : null}
      <Button
        type="button"
        size="small"
        className="self-start"
        onClick={() =>
          triggerAction('', undefined, startOutreachPlan(props.channel))
        }
      >
        {props.ctaLabel ?? SERVE_PROPOSAL_CTA[proposalChannel]}
      </Button>
    </div>
  )
}

const OutreachCard = defineComponent({
  ...OpenUiOutreachCard,
  component: OutreachCardView,
})

const ChoiceQuestionView = ({
  props,
  statementId,
}: ComponentRenderProps<z.infer<typeof OpenUiChoiceQuestion.props>>) => {
  const triggerAction = useTriggerAction()
  const streaming = useIsStreaming()
  const key = statementId ?? props.question
  const selected = useStateField<string[]>(`${key}.selected`, [])
  const answered = useStateField<string>(`${key}.answer`, '')
  const options = props.options ?? []
  const picked = selected.value ?? []
  const locked = streaming || Boolean(answered.value)
  const send = (labels: string[]): void => {
    if (locked || labels.length === 0) return
    const answer = formatClarifyChoices(labels)
    answered.setValue(answer)
    triggerAction(answer)
  }
  const optionClass = cn(
    'flex items-center gap-3',
    OPTION_CARD_CLASS,
    'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5',
    !locked && OPTION_CARD_INTERACTIVE_CLASS,
  )
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium text-foreground">{props.question}</p>
      {props.multi ? (
        <>
          <div role="group" className="flex flex-col gap-2">
            {options.map((option, i) => {
              const id = `${key}-opt-${i}`
              return (
                <Label key={id} htmlFor={id} className={optionClass}>
                  <Checkbox
                    id={id}
                    checked={picked.includes(option)}
                    disabled={locked}
                    onCheckedChange={(state) =>
                      selected.setValue(
                        options.filter((label) =>
                          label === option
                            ? state === true
                            : picked.includes(label),
                        ),
                      )
                    }
                  />
                  <span className="text-sm font-medium text-foreground">
                    {option}
                  </span>
                </Label>
              )
            })}
          </div>
          {locked ? null : (
            <Button
              type="button"
              size="small"
              className="self-start"
              disabled={picked.length === 0}
              onClick={() => send(picked)}
            >
              {picked.length === 1
                ? OPEN_UI_COPY.useThis
                : OPEN_UI_COPY.useThese}
            </Button>
          )}
        </>
      ) : (
        <RadioGroup
          className="flex flex-col gap-2"
          disabled={locked}
          value={picked[0] ?? ''}
          onValueChange={(value) => {
            selected.setValue([value])
            send([value])
          }}
        >
          {options.map((option, i) => {
            const id = `${key}-opt-${i}`
            return (
              <Label key={id} htmlFor={id} className={optionClass}>
                <RadioGroupItem value={option} id={id} />
                <span className="text-sm font-medium text-foreground">
                  {option}
                </span>
              </Label>
            )
          })}
        </RadioGroup>
      )}
    </div>
  )
}

const ChoiceQuestion = defineComponent({
  ...OpenUiChoiceQuestion,
  component: ChoiceQuestionView,
})

const ActionButtonView = ({
  props,
}: ComponentRenderProps<z.infer<typeof OpenUiActionButton.props>>) => {
  const triggerAction = useTriggerAction()
  return (
    <Button
      type="button"
      size="small"
      variant="outline"
      className="self-start"
      onClick={() => triggerAction(props.label, undefined, props.action)}
    >
      {props.label}
    </Button>
  )
}

const ActionButton = defineComponent({
  ...OpenUiActionButton,
  component: ActionButtonView,
})

export const openUiLibrary = createLibrary({
  root: OpenUiStack.name,
  components: [
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
  ],
  actions: [OpenUiStartOutreach],
})
