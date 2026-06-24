import { Badge } from '@styleguide/components/ui/badge'

export type TimelineStatus = 'done' | 'active' | 'upcoming'
export type TimelineVariant = 'steps' | 'timeline'

type IconComponent = React.ComponentType<{ className?: string }>

export type TimelineItem = {
  label: string
  title: string
  description?: string
  quote?: string
  quoteAttribution?: string
  items?: string[]
  link?: { label: string; href: string }
  source?: { organization: string; title: string; url?: string }
  /** Only used in `variant="steps"` */
  status?: TimelineStatus
  /** Only used in `variant="steps"` */
  icon?: IconComponent
  /** Only used in `variant="steps"` */
  badge?: string
}

const STEP_COLORS = [
  'bg-brand-blue-200',
  'bg-brand-halo-green-200',
  'bg-brand-lavender-200',
  'bg-brand-waxflower-200',
  'bg-brand-bright-yellow-200',
  'bg-brand-red-200',
]

function isSafeHref(href: string): boolean {
  return href === '#' || /^https?:\/\//i.test(href)
}

export default function ChatTimeline({
  items,
  variant = 'steps',
}: {
  items: TimelineItem[]
  variant?: TimelineVariant
}) {
  const isTimeline = variant === 'timeline'

  return (
    <div className="flex flex-col" role="list">
      {items.map((item, i) => {
        const status = item.status ?? 'done'
        const isLast = i === items.length - 1

        return (
          <div key={`${item.label}-${item.title}`} className="relative flex gap-3" role="listitem">
            <div className="flex flex-col items-center">
              {isTimeline ? (
                <div className="mt-1 size-2.5 shrink-0 rounded-full bg-primary" />
              ) : status === 'done' ? (
                <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted">
                  <span className="text-xs font-semibold leading-none text-muted-foreground">{i + 1}</span>
                </div>
              ) : (
                <div className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${STEP_COLORS[i % STEP_COLORS.length]}`}>
                  <span className="text-xs font-semibold leading-none text-brand-midnight-700">{i + 1}</span>
                </div>
              )}
              {!isTimeline && !isLast && (
                <div className="w-px flex-1 bg-transparent" />
              )}
              {isTimeline && !isLast && (
                <div className="w-px flex-1 bg-primary" />
              )}
            </div>

            <div className={`flex flex-col gap-3 min-w-0 ${isLast ? '' : 'pb-6'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{item.label}</span>
                <span className="text-sm text-foreground">{item.title}</span>
                {!isTimeline && item.badge && (
                  <Badge variant="soft" shape="pill">{item.badge}</Badge>
                )}
              </div>

              {item.description && (
                <p className="text-sm leading-normal text-foreground">{item.description}</p>
              )}

              {item.items && item.items.length > 0 && (
                <ul className="flex flex-col gap-0.5 pl-3">
                  {item.items.map((it) => (
                    <li key={it} className="flex items-start gap-1.5 text-sm leading-normal text-foreground">
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/40" />
                      {it}
                    </li>
                  ))}
                </ul>
              )}

              {item.link && isSafeHref(item.link.href) && (
                <a
                  href={item.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-fit text-xs tracking-wide text-primary underline-offset-4 hover:underline"
                >
                  {item.link.label}
                </a>
              )}

              {item.quote && (
                <blockquote className="flex flex-col gap-1 border-l-2 border-border pl-3">
                  <p className="text-sm italic leading-normal text-foreground">{item.quote}</p>
                  {item.quoteAttribution && (
                    <p className="text-xs text-muted-foreground">{item.quoteAttribution}</p>
                  )}
                </blockquote>
              )}

              {item.source && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Source:</span>{' '}
                  {item.source.url && isSafeHref(item.source.url) ? (
                    <a
                      href={item.source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {item.source.organization} — {item.source.title}
                    </a>
                  ) : (
                    <>{item.source.organization} — {item.source.title}</>
                  )}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
