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
  source?: string
  /** Only used in `variant="steps"` */
  status?: TimelineStatus
  /** Only used in `variant="steps"` */
  icon?: IconComponent
  /** Only used in `variant="steps"` */
  badge?: string
}

const bulletColorClass: Record<TimelineStatus, string> = {
  done: 'border-primary bg-primary text-primary-foreground',
  active: 'border-primary bg-background text-primary',
  upcoming:
    'border-muted-foreground/40 bg-background text-muted-foreground/60 dark:border-muted-foreground/60 dark:text-muted-foreground',
}

const connectorClass: Record<TimelineStatus, string> = {
  done: 'bg-primary',
  active: 'bg-primary',
  upcoming: 'bg-muted-foreground/30',
}

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
        const Icon = !isTimeline ? item.icon : undefined

        return (
          <div key={`${item.label}-${item.title}`} className="relative flex gap-3" role="listitem">
            <div className="flex flex-col items-center">
              {isTimeline ? (
                <div className="mt-1 size-2.5 shrink-0 rounded-full bg-primary" />
              ) : (
                <div
                  className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${bulletColorClass[status]}`}
                >
                  {Icon && <Icon className="size-2.5" />}
                </div>
              )}
              {!isLast && (
                <div className={`w-px flex-1 ${isTimeline ? 'bg-primary' : connectorClass[status]}`} />
              )}
            </div>

            <div className={`flex flex-col gap-3 min-w-0 ${isLast ? '' : 'pb-8'}`}>
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

              {item.quote && (
                <blockquote className="border-l-2 border-border pl-3">
                  <p className="text-sm italic leading-normal text-foreground">{item.quote}</p>
                  {item.quoteAttribution && (
                    <cite className="mt-1 block not-italic text-xs text-foreground">{item.quoteAttribution}</cite>
                  )}
                </blockquote>
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

              {item.source && (
                <p className="text-xs leading-normal tracking-wide text-foreground"><span className="font-medium">Source:</span> {item.source}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
